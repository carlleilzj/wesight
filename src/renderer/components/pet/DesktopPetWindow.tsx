import './DesktopPetWindow.css';

import {
  DEFAULT_PET_CONFIG,
  normalizePetConfig,
  type PetConfig,
  PetMotion,
  type PetPosition,
} from '@shared/pet/constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import PetSprite, { PetMood } from './PetSprite';

const DragPhase = {
  Idle: 'idle',
  Pressing: 'pressing',
  Dragging: 'dragging',
} as const;

type DragPhase = typeof DragPhase[keyof typeof DragPhase];

interface DesktopPetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragState = {
  phase: DragPhase;
  startScreenX: number;
  startScreenY: number;
  startBounds: DesktopPetBounds | null;
  lastPosition: PetPosition | null;
};

const IDLE_BUBBLE_KEYS = [
  'desktopPetBubbleIdle',
  'desktopPetBubbleFocus',
  'desktopPetBubbleHappy',
] as const;

const MOVE_THRESHOLD_PX = 4;
const BUBBLE_HIDE_DELAY_MS = 2100;
const WANDER_INTERVAL_MS = 7800;

const DesktopPetWindow: React.FC = () => {
  const [config, setConfig] = useState<PetConfig>(() => DEFAULT_PET_CONFIG);
  const [mood, setMood] = useState<PetMood>(PetMood.Idle);
  const [bubbleKey, setBubbleKey] = useState<string>('desktopPetBubbleIdle');
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [dragPhase, setDragPhase] = useState<DragPhase>(DragPhase.Idle);
  const bubbleTimerRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>({
    phase: DragPhase.Idle,
    startScreenX: 0,
    startScreenY: 0,
    startBounds: null,
    lastPosition: null,
  });
  const isAnimatingMoveRef = useRef(false);

  const showBubble = useCallback((key: string, durationMs = BUBBLE_HIDE_DELAY_MS) => {
    setBubbleKey(key);
    setIsBubbleVisible(true);
    if (bubbleTimerRef.current != null) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => {
      setIsBubbleVisible(false);
      bubbleTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('desktop-pet-page');
    void i18nService.initialize();

    let active = true;
    void window.electron.desktopPet.getConfig().then((nextConfig) => {
      if (!active) return;
      setConfig(normalizePetConfig(nextConfig));
    });

    const unsubscribe = window.electron.desktopPet.onConfigChanged((nextConfig) => {
      setConfig(normalizePetConfig(nextConfig));
      showBubble('desktopPetBubbleChanged');
    });

    return () => {
      active = false;
      unsubscribe();
      document.documentElement.classList.remove('desktop-pet-page');
      if (bubbleTimerRef.current != null) {
        window.clearTimeout(bubbleTimerRef.current);
      }
    };
  }, [showBubble]);

  const updateMoodForClick = useCallback(() => {
    setMood((current) => {
      if (current === PetMood.Happy) return PetMood.Focus;
      if (current === PetMood.Focus) return PetMood.Idle;
      return PetMood.Happy;
    });
    const key = IDLE_BUBBLE_KEYS[Math.floor(Math.random() * IDLE_BUBBLE_KEYS.length)];
    showBubble(key);
  }, [showBubble]);

  const animateToPosition = useCallback(async (target: PetPosition) => {
    if (isAnimatingMoveRef.current || dragRef.current.phase !== DragPhase.Idle) {
      return;
    }

    const bounds = await window.electron.desktopPet.getBounds();
    if (!bounds) {
      return;
    }

    isAnimatingMoveRef.current = true;
    setMood(PetMood.Walking);
    const start = { x: bounds.x, y: bounds.y };
    const startTime = performance.now();
    const durationMs = 920;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      void window.electron.desktopPet.setPosition({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        persist: progress === 1,
      });

      if (progress < 1 && dragRef.current.phase === DragPhase.Idle) {
        window.requestAnimationFrame(step);
        return;
      }

      isAnimatingMoveRef.current = false;
      setMood(PetMood.Idle);
    };

    window.requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!config.enabled || config.motion !== PetMotion.Playful) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (dragRef.current.phase !== DragPhase.Idle || isAnimatingMoveRef.current) {
        return;
      }

      void window.electron.desktopPet.getBounds().then((bounds) => {
        if (!bounds || dragRef.current.phase !== DragPhase.Idle) {
          return;
        }
        const direction = Math.random() > 0.5 ? 1 : -1;
        const distance = 18 + Math.round(Math.random() * 24);
        void animateToPosition({
          x: bounds.x + direction * distance,
          y: bounds.y + Math.round((Math.random() - 0.5) * 18),
        });
      });
    }, WANDER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [animateToPosition, config.enabled, config.motion]);

  const handlePointerDown = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = await window.electron.desktopPet.getBounds();
    dragRef.current = {
      phase: DragPhase.Pressing,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startBounds: bounds,
      lastPosition: bounds ? { x: bounds.x, y: bounds.y } : null,
    };
    setDragPhase(DragPhase.Pressing);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current;
    if (dragState.phase === DragPhase.Idle || !dragState.startBounds) {
      return;
    }

    const deltaX = event.screenX - dragState.startScreenX;
    const deltaY = event.screenY - dragState.startScreenY;
    const isPastThreshold = Math.abs(deltaX) > MOVE_THRESHOLD_PX || Math.abs(deltaY) > MOVE_THRESHOLD_PX;

    if (!isPastThreshold && dragState.phase !== DragPhase.Dragging) {
      return;
    }

    const nextPosition = {
      x: dragState.startBounds.x + deltaX,
      y: dragState.startBounds.y + deltaY,
    };

    dragRef.current = {
      ...dragState,
      phase: DragPhase.Dragging,
      lastPosition: nextPosition,
    };
    setDragPhase(DragPhase.Dragging);
    setMood(PetMood.Dragging);
    void window.electron.desktopPet.setPosition({
      ...nextPosition,
      persist: false,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (dragState.phase === DragPhase.Dragging && dragState.lastPosition) {
      void window.electron.desktopPet.setPosition({
        ...dragState.lastPosition,
        persist: true,
      });
      showBubble('desktopPetBubbleDragged');
    } else {
      updateMoodForClick();
    }

    dragRef.current = {
      phase: DragPhase.Idle,
      startScreenX: 0,
      startScreenY: 0,
      startBounds: null,
      lastPosition: null,
    };
    setDragPhase(DragPhase.Idle);
    window.setTimeout(() => {
      setMood(PetMood.Idle);
    }, 1200);
  };

  const handleDoubleClick = () => {
    void window.electron.desktopPet.openMainWindow();
    showBubble('desktopPetBubbleOpenMain');
  };

  const stageClassName = [
    'desktop-pet-stage',
    dragPhase === DragPhase.Dragging ? 'desktop-pet-stage--dragging' : '',
    isBubbleVisible ? 'desktop-pet-stage--bubble' : '',
  ].filter(Boolean).join(' ');

  const resolvedMood = useMemo(() => {
    if (dragPhase === DragPhase.Dragging) return PetMood.Dragging;
    return mood;
  }, [dragPhase, mood]);

  if (!config.enabled) {
    return null;
  }

  return (
    <main className={stageClassName}>
      <div
        className="desktop-pet-hit-area"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        role="button"
        tabIndex={0}
        aria-label={i18nService.t('desktopPetAria')}
      >
        <div className="desktop-pet-bubble">
          {i18nService.t(bubbleKey)}
        </div>
        <div className="desktop-pet-sprite-wrap">
          <PetSprite
            variant={config.variant}
            motion={config.motion}
            mood={resolvedMood}
            size={138}
          />
        </div>
        <span className="desktop-pet-action-dot" aria-hidden="true" />
      </div>
    </main>
  );
};

export default DesktopPetWindow;
