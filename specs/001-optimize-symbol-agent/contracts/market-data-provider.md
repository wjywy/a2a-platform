# Market Data Provider Contract

这是 Symbol 研究编排层依赖的内部只读契约。实现可以使用官方 Longbridge Node SDK，但 `symbol-service.ts`、LangGraph 节点和模型 prompt 不得依赖 SDK 原始类型。

## Provider interface

```ts
type ProviderStatus = "available" | "degraded" | "unavailable";
type PermissionStatus = "available" | "missing" | "expired" | "unknown";
type Freshness = "live" | "delayed" | "stale" | "unknown";

type ProviderContext = {
  tenantId: string;
  agentSlug: string;
  requestId: string;
  signal?: AbortSignal;
};

interface MarketDataProvider {
  getQuote(symbol: string, ctx: ProviderContext): Promise<QuoteResult>;
  getOptionChain(symbol: string, ctx: ProviderContext): Promise<OptionChainResult>;
  getOptionQuotes(symbols: string[], ctx: ProviderContext): Promise<OptionQuoteResult>;
}

type EvidenceMeta = {
  provider: "longbridge" | "fallback";
  status: ProviderStatus;
  permission: PermissionStatus;
  asOf?: string;
  fetchedAt: string;
  freshness: Freshness;
  degradedReason?: string;
};
```

每个方法都必须返回可序列化的领域对象或带 `status` 的结果，不得把权限异常转换为零值。没有足够数据时返回 `unavailable`/`degraded` 及原因；只有真正有数据时才填价格、持仓量、Gamma 等数值。

## Quote result

```ts
type QuoteResult = {
  meta: EvidenceMeta;
  symbol: string;
  providerSymbol: string; // 例如 AAPL.US
  price?: number;
  previousClose?: number;
  change?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  turnover?: number;
  tradeStatus?: string;
  session?: "regular" | "pre" | "post" | "closed" | "unknown";
};
```

Longbridge 的最新价必须带 `meta.asOf` 或明确的 unknown；若只有延迟/缓存报价，`freshness` 必须相应标记，模型上下文中不可称其为当前成交。

## Option chain and quote result

```ts
type OptionChainResult = {
  meta: EvidenceMeta;
  underlying: string;
  expiries: Array<{ expiry: string; strikes: number[] }>;
  contracts: Array<{
    symbol: string;
    expiry: string;
    strike: number;
    side: "call" | "put";
  }>;
};

type OptionQuoteResult = {
  meta: EvidenceMeta;
  underlying: string;
  quotes: Array<{
    symbol: string;
    expiry: string;
    strike: number;
    side: "call" | "put";
    last?: number;
    bid?: number;
    ask?: number;
    volume?: number;
    openInterest?: number;
    impliedVolatility?: number;
    gamma?: number;
    contractMultiplier?: number;
    quoteAsOf?: string;
    unavailable: string[];
  }>;
};
```

期权链过大时由调用方按用户期间、距离现价范围和流动性边界分批/裁剪；裁剪范围必须进入 Gamma `scope`，不能让模型误以为覆盖全市场。期权报价时间与标的报价时间分开保存。

## Longbridge adapter rules

1. 适配器负责 `CODE.MARKET` 转换、OAuth/token 生命周期、SDK 异常映射、响应字段校验和限流/超时；token 只存在内存或加密凭据解密结果的短生命周期内。
2. 适配器只读，不调用交易 API；日志仅记录 provider、endpoint 类别、状态码、requestId 和耗时，不记录 Authorization、完整响应或账户信息。
3. 缺少租户凭据、OpenAPI 权限或美国 OPRA 权限分别映射为可区分的 `permission`/`degradedReason`。
4. Provider 不负责自然语言。它只给出证据和状态；由当前 Agent 模型解释事实、假设和限制。
5. 第一期使用 pull snapshot 以保证一次研究运行可复现；未来 WebSocket 订阅可实现相同领域对象，但不改变此契约。

## Gamma analyzer contract

```ts
interface GammaAnalyzer {
  analyze(input: {
    spot: number;
    quotes: OptionQuoteResult["quotes"];
    asOf: string;
    scope: { expiries?: string[]; minStrike?: number; maxStrike?: number };
  }): GammaExposureAnalysis;
}
```

计算必须显式返回：公式、spot、范围、call/put 符号假设、contractMultiplier 来源、gross exposure、modeled signed exposure、情景区间、被排除合约和限制。默认 1% 归一化公式为 `gamma * openInterest * contractMultiplier * spot^2 * 0.01`；缺失参与字段的合约进入排除清单而不是当作零。

Gamma 结果是研究证据的派生视图。Agent 必须把它表达为局部敏感度和情景风险，不输出保证涨跌、买卖指令或个性化投资建议。
