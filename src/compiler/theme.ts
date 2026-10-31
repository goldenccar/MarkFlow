import type { Theme } from './types.js'

/** Explicit document defaults, unrelated to the desktop reader's preferences. Sizes are points. */
export const standardTheme: Theme = {
  id: 'standard-v1', version: 1, fontFamily: 'Microsoft YaHei',
  ink: '202B36', muted: '586778', accent: '256C69', background: 'F5F6F3',
  note: { widthPt: 595.28, heightPt: 841.89, marginPt: 54, bodyPt: 11, headingPt: [24, 17, 14, 12, 11, 11], lineHeight: 1.35 },
  stage: { widthPt: 960, heightPt: 540, marginPt: 48, titlePt: 30, coverPt: 42, bodyPt: 21, minimumPt: 18, lineHeight: 1.35 },
}
