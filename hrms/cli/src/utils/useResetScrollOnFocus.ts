import { RefObject, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';

type ScrollableRef = {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void;
};

export const useResetScrollOnFocus = (ref: RefObject<ScrollableRef | null>) => {
  useFocusEffect(
    useCallback(() => {
      const frame = requestAnimationFrame(() => {
        ref.current?.scrollTo?.({ x: 0, y: 0, animated: false });
        ref.current?.scrollToOffset?.({ offset: 0, animated: false });
      });

      return () => cancelAnimationFrame(frame);
    }, [ref])
  );
};
