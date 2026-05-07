import './PetSprite.css';

import {
  PetMotion,
  type PetMotion as PetMotionType,
  PetVariant,
  type PetVariant as PetVariantType,
} from '@shared/pet/constants';
import React from 'react';

export const PetMood = {
  Idle: 'idle',
  Happy: 'happy',
  Focus: 'focus',
  Dragging: 'dragging',
  Walking: 'walking',
} as const;

export type PetMood = typeof PetMood[keyof typeof PetMood];

type PetPalette = {
  shell: string;
  shellDark: string;
  face: string;
  faceDark: string;
  accent: string;
  blush: string;
  line: string;
};

const PET_PALETTES: Record<PetVariantType, PetPalette> = {
  [PetVariant.BlueBot]: {
    shell: '#4169e1',
    shellDark: '#1e3a8a',
    face: '#1f2937',
    faceDark: '#111827',
    accent: '#60a5fa',
    blush: '#a5b4fc',
    line: '#0f172a',
  },
  [PetVariant.AquaDrop]: {
    shell: '#38bdf8',
    shellDark: '#0e7490',
    face: '#e0f2fe',
    faceDark: '#bae6fd',
    accent: '#06b6d4',
    blush: '#fb7185',
    line: '#075985',
  },
  [PetVariant.FlameBuddy]: {
    shell: '#fb923c',
    shellDark: '#c2410c',
    face: '#fff7ed',
    faceDark: '#fed7aa',
    accent: '#ef4444',
    blush: '#fda4af',
    line: '#7c2d12',
  },
  [PetVariant.WoodBox]: {
    shell: '#d6a86c',
    shellDark: '#8b5e34',
    face: '#fef3c7',
    faceDark: '#fde68a',
    accent: '#84cc16',
    blush: '#f9a8d4',
    line: '#422006',
  },
  [PetVariant.SproutBox]: {
    shell: '#e7d37f',
    shellDark: '#a16207',
    face: '#fef9c3',
    faceDark: '#fde68a',
    accent: '#65a30d',
    blush: '#fda4af',
    line: '#3f3f1f',
  },
  [PetVariant.StackBot]: {
    shell: '#6b7280',
    shellDark: '#374151',
    face: '#4b5563',
    faceDark: '#1f2937',
    accent: '#a78bfa',
    blush: '#c4b5fd',
    line: '#111827',
  },
  [PetVariant.AstroBot]: {
    shell: '#e5e7eb',
    shellDark: '#94a3b8',
    face: '#0284c7',
    faceDark: '#0f172a',
    accent: '#22d3ee',
    blush: '#f0abfc',
    line: '#0f172a',
  },
  [PetVariant.ShadowBot]: {
    shell: '#111827',
    shellDark: '#020617',
    face: '#1f2937',
    faceDark: '#030712',
    accent: '#ef4444',
    blush: '#f43f5e',
    line: '#000000',
  },
};

interface PetSpriteProps {
  variant: PetVariantType;
  motion?: PetMotionType;
  mood?: PetMood;
  size?: number;
  className?: string;
}

const renderEyes = (palette: PetPalette, mood: PetMood) => {
  if (mood === PetMood.Happy) {
    return (
      <>
        <path d="M42 48 L47 44 L52 48" fill="none" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M68 48 L73 44 L78 48" fill="none" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  }

  if (mood === PetMood.Focus) {
    return (
      <>
        <rect x="42" y="44" width="10" height="8" rx="2" fill={palette.accent} />
        <rect x="68" y="44" width="10" height="8" rx="2" fill={palette.accent} />
      </>
    );
  }

  return (
    <>
      <rect className="pet-sprite__eye" x="43" y="43" width="8" height="10" rx="2" fill={palette.accent} />
      <rect className="pet-sprite__eye pet-sprite__eye--right" x="69" y="43" width="8" height="10" rx="2" fill={palette.accent} />
    </>
  );
};

const renderMouth = (palette: PetPalette, mood: PetMood) => {
  if (mood === PetMood.Happy) {
    return <path d="M54 61 C58 68 66 68 70 61" fill="none" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" />;
  }
  if (mood === PetMood.Dragging) {
    return <path d="M57 62 H68" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" />;
  }
  return <path d="M57 61 C60 64 65 64 68 61" fill="none" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" />;
};

const VariantAccessory: React.FC<{ variant: PetVariantType; palette: PetPalette }> = ({ variant, palette }) => {
  switch (variant) {
    case PetVariant.AquaDrop:
      return (
        <path d="M60 5 C77 24 86 40 81 52 C76 66 45 66 39 52 C34 39 43 23 60 5Z" fill={palette.shell} stroke={palette.line} strokeWidth="2.5" />
      );
    case PetVariant.FlameBuddy:
      return (
        <>
          <path d="M60 8 C70 18 73 28 66 36 C67 28 57 26 60 14 C48 23 47 33 54 39 C42 34 45 18 60 8Z" fill="#facc15" stroke={palette.line} strokeWidth="2" />
          <path d="M61 18 C66 25 65 31 60 35 C61 29 55 27 58 20Z" fill="#ef4444" opacity="0.92" />
        </>
      );
    case PetVariant.SproutBox:
      return (
        <>
          <path d="M60 21 V34" stroke={palette.line} strokeWidth="3" strokeLinecap="round" />
          <path d="M59 21 C48 12 38 13 34 21 C45 24 53 23 59 21Z" fill="#86efac" stroke={palette.line} strokeWidth="2" />
          <path d="M61 21 C72 10 82 11 86 19 C76 24 67 23 61 21Z" fill="#65a30d" stroke={palette.line} strokeWidth="2" />
        </>
      );
    case PetVariant.StackBot:
      return (
        <>
          <rect x="50" y="11" width="20" height="10" rx="3" fill={palette.shellDark} stroke={palette.line} strokeWidth="2" />
          <circle className="pet-sprite__spark" cx="60" cy="8" r="3" fill={palette.accent} />
        </>
      );
    case PetVariant.AstroBot:
      return (
        <>
          <path d="M60 12 V27" stroke={palette.line} strokeWidth="3" strokeLinecap="round" />
          <circle className="pet-sprite__spark" cx="60" cy="10" r="4" fill={palette.accent} />
        </>
      );
    case PetVariant.ShadowBot:
      return (
        <path d="M53 18 C56 9 67 9 69 18 C72 20 74 24 74 29 H48 C48 24 50 20 53 18Z" fill={palette.shellDark} stroke={palette.line} strokeWidth="2" />
      );
    default:
      return (
        <path d="M47 24 C50 16 70 16 73 24" fill="none" stroke={palette.line} strokeWidth="3" strokeLinecap="round" />
      );
  }
};

const PetSprite: React.FC<PetSpriteProps> = ({
  variant,
  motion = PetMotion.Calm,
  mood = PetMood.Idle,
  size = 128,
  className = '',
}) => {
  const palette = PET_PALETTES[variant];
  const isDrop = variant === PetVariant.AquaDrop;
  const isWoodLike = variant === PetVariant.WoodBox || variant === PetVariant.SproutBox;
  const spriteClassName = [
    'pet-sprite',
    motion === PetMotion.Playful ? 'pet-sprite--playful' : '',
    mood === PetMood.Happy ? 'pet-sprite--happy' : '',
    mood === PetMood.Dragging ? 'pet-sprite--dragging' : '',
    mood === PetMood.Walking ? 'pet-sprite--walking' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={spriteClassName}
      width={size}
      height={size}
      viewBox="0 0 120 140"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <ellipse cx="60" cy="127" rx="30" ry="8" fill="rgba(15, 23, 42, 0.18)" />
      <VariantAccessory variant={variant} palette={palette} />

      <g className="pet-sprite__arm-left">
        <path d="M33 75 C20 77 17 90 25 96" fill="none" stroke={palette.line} strokeWidth="5" strokeLinecap="round" />
        <circle cx="24" cy="96" r="5" fill={palette.shell} stroke={palette.line} strokeWidth="2" />
      </g>
      <g className="pet-sprite__arm-right">
        <path d="M87 75 C100 77 103 90 95 96" fill="none" stroke={palette.line} strokeWidth="5" strokeLinecap="round" />
        <circle cx="96" cy="96" r="5" fill={palette.shell} stroke={palette.line} strokeWidth="2" />
      </g>

      <rect x="34" y="72" width="52" height="48" rx="14" fill={palette.shell} stroke={palette.line} strokeWidth="3" />
      <rect x="43" y="83" width="34" height="18" rx="7" fill={palette.faceDark} opacity="0.22" />
      <rect className="pet-sprite__leg-left" x="43" y="116" width="12" height="13" rx="5" fill={palette.shellDark} stroke={palette.line} strokeWidth="2" />
      <rect className="pet-sprite__leg-right" x="65" y="116" width="12" height="13" rx="5" fill={palette.shellDark} stroke={palette.line} strokeWidth="2" />

      {isDrop ? (
        <path d="M60 27 C77 47 87 60 84 76 C81 94 40 94 36 76 C33 60 43 47 60 27Z" fill={palette.shell} stroke={palette.line} strokeWidth="3" />
      ) : isWoodLike ? (
        <rect x="33" y="33" width="54" height="44" rx="11" fill={palette.face} stroke={palette.line} strokeWidth="3" />
      ) : (
        <rect x="31" y="28" width="58" height="52" rx="16" fill={palette.shell} stroke={palette.line} strokeWidth="3" />
      )}

      <rect x="38" y="36" width="44" height="33" rx="10" fill={palette.face} stroke={palette.line} strokeWidth="3" />
      <rect x="40" y="38" width="40" height="29" rx="8" fill={palette.faceDark} opacity={variant === PetVariant.ShadowBot ? 0.82 : 0.92} />
      {renderEyes(palette, mood)}
      {renderMouth(palette, mood)}
      <circle cx="35" cy="64" r="4" fill={palette.blush} opacity="0.75" />
      <circle cx="85" cy="64" r="4" fill={palette.blush} opacity="0.75" />

      {variant === PetVariant.WoodBox && (
        <path d="M43 32 C49 23 72 23 78 32" fill="none" stroke={palette.line} strokeWidth="3" strokeLinecap="round" />
      )}
      {variant === PetVariant.ShadowBot && (
        <g fill={palette.accent}>
          <rect x="49" y="54" width="5" height="5" rx="1" />
          <rect x="58" y="54" width="5" height="5" rx="1" />
          <rect x="67" y="54" width="5" height="5" rx="1" />
        </g>
      )}
    </svg>
  );
};

export default PetSprite;
