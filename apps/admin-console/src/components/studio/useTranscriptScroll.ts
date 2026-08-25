import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const NEAR_BOTTOM_PX = 96;

export type TranscriptScroll = {
  scrollRef: RefObject<HTMLDivElement | null>;
  isNearBottom: boolean;
  hasUnreadBelow: boolean;
  scrollToLatest: (behavior?: ScrollBehavior) => void;
  markConversationChanged: () => void;
};

/**
 * Keeps a streaming transcript pinned only while the operator is already near
 * its tail. Reading an earlier answer must not be interrupted by every token.
 */
export function useTranscriptScroll(
  dependency: unknown,
  streamActive: boolean,
): TranscriptScroll {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const shouldPin = useRef(true);
  const previousHeight = useRef(0);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return true;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const next = distance <= NEAR_BOTTOM_PX;
    shouldPin.current = next;
    setIsNearBottom(next);
    if (next) setHasUnreadBelow(false);
    return next;
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    shouldPin.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);
  }, []);

  const markConversationChanged = useCallback(() => {
    previousHeight.current = 0;
    requestAnimationFrame(() => scrollToLatest("auto"));
  }, [scrollToLatest]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      const height = element.scrollHeight;
      const grew = height > previousHeight.current;
      previousHeight.current = height;
      if (!grew) return;
      if (shouldPin.current) scrollToLatest(streamActive ? "auto" : "smooth");
      else setHasUnreadBelow(true);
    });
    observer.observe(element);
    previousHeight.current = element.scrollHeight;
    measure();
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [measure, scrollToLatest, streamActive]);

  useEffect(() => {
    if (streamActive && shouldPin.current) scrollToLatest("auto");
  }, [dependency, scrollToLatest, streamActive]);

  return {
    scrollRef,
    isNearBottom,
    hasUnreadBelow,
    scrollToLatest,
    markConversationChanged,
  };
}
