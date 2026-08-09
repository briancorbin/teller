import type { Token, TokenEffect } from '../../worker/types';

// Zone token render vocabulary — presentation only, shared by the
// scene editor preview and the table. Fire is drawn; what fire DOES
// stays with the humans (docs/BATTLEMAP.md).

/** Centering + zone footprint (shape/rotation) as inline transform. */
export function tokenShapeStyle(token: Token): React.CSSProperties {
  const rot = token.rot ?? 0;
  const shape = token.shape ?? 'circle';
  return {
    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
    borderRadius: shape === 'circle' ? '9999px' : shape === 'square' ? '4px' : '0',
    clipPath:
      shape === 'triangle' ? 'polygon(50% 0%, 100% 100%, 0% 100%)' : undefined,
  };
}

export const TOKEN_EFFECTS: { value: TokenEffect; label: string }[] = [
  { value: 'fire', label: 'fire' },
  { value: 'oil', label: 'oil' },
  { value: 'smoke', label: 'smoke' },
  { value: 'ice', label: 'ice' },
  { value: 'poison', label: 'poison' },
  { value: 'water', label: 'water' },
];

/**
 * Gooey tile-layer vocabulary. The blur+contrast merge filter REQUIRES
 * opaque fills (semi-transparent input dies in the alpha contrast), so
 * fills are solid and translucency is applied to the group AFTER the
 * filter.
 */
export function zoneBase(effect: TokenEffect): {
  fill: string;
  opacity: number;
  core?: string;
} {
  switch (effect) {
    case 'fire':
      return { fill: '#f97316', opacity: 0.7, core: 'rgba(253,224,71,0.85)' };
    case 'oil':
      return { fill: '#14101c', opacity: 0.8 };
    case 'smoke':
      return { fill: '#b4afaa', opacity: 0.55 };
    case 'ice':
      return { fill: '#93c5fd', opacity: 0.55 };
    case 'poison':
      return { fill: '#84cc16', opacity: 0.55, core: 'rgba(190,242,100,0.6)' };
    case 'water':
      return { fill: '#0ea5e9', opacity: 0.55 };
  }
}

export function zoneStyle(effect: TokenEffect): {
  background: string;
  animate: boolean;
  boxShadow?: string;
} {
  switch (effect) {
    case 'fire':
      return {
        background:
          'radial-gradient(circle, rgba(253,224,71,0.8) 0%, rgba(249,115,22,0.65) 40%, rgba(220,38,38,0.45) 70%, rgba(120,20,10,0.15) 90%, transparent 100%)',
        animate: true,
      };
    case 'oil':
      return {
        background:
          'radial-gradient(ellipse, rgba(15,12,20,0.85) 0%, rgba(30,27,40,0.7) 60%, rgba(40,35,55,0.35) 85%, transparent 100%)',
        animate: false,
        boxShadow: 'inset 0 0 12px rgba(147,51,234,0.35)',
      };
    case 'smoke':
      return {
        background:
          'radial-gradient(circle, rgba(214,211,209,0.55) 0%, rgba(168,162,158,0.4) 55%, rgba(120,113,108,0.2) 80%, transparent 100%)',
        animate: true,
      };
    case 'ice':
      return {
        background:
          'radial-gradient(circle, rgba(191,219,254,0.65) 0%, rgba(96,165,250,0.4) 60%, rgba(37,99,235,0.15) 85%, transparent 100%)',
        animate: false,
      };
    case 'poison':
      return {
        background:
          'radial-gradient(circle, rgba(163,230,53,0.55) 0%, rgba(77,124,15,0.4) 60%, rgba(20,60,20,0.15) 85%, transparent 100%)',
        animate: true,
      };
    case 'water':
      return {
        background:
          'radial-gradient(circle, rgba(125,211,252,0.6) 0%, rgba(14,165,233,0.4) 60%, rgba(3,105,161,0.15) 85%, transparent 100%)',
        animate: false,
      };
  }
}
