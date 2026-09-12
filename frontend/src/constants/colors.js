export const AVATAR_COLORS = [
  "#00a884",
  "#53bdeb",
  "#06cf9c",
  "#02a698",
  "#e67e22",
  "#9b59b6",
  "#3498db",
  "#1abc9c",
  "#d35400",
  "#27ae60",
];

export function getAvatarColor(key) {
  const text = String(key || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
