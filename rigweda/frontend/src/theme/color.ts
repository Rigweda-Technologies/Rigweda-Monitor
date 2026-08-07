export const normalizeHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : null;

const rgb = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
const luminance = (hex: string) => rgb(hex).map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export const contrastRatio = (first: string, second: string) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
};
export const readableOnWhite = (hex: string) => contrastRatio(hex, "#ffffff") >= 4.5;
export const shadeHex = (hex: string, factor: number) => `#${rgb(hex).map((value) => Math.max(0, Math.min(255, Math.round(value * factor))).toString(16).padStart(2, "0")).join("")}`;
