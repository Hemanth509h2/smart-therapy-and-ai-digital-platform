// Display-only nicknames derived from the random post/comment id. They carry no identity:
// ids are random UUIDs, so the same person gets a different nickname on every post.
const ADJ = ["calm", "brave", "bright", "quiet", "kind", "swift", "gentle", "witty", "bold", "sunny", "clever", "merry", "noble", "lucky", "eager", "cosmic"];
const ANIMAL = ["otter", "falcon", "panda", "koala", "lynx", "heron", "fox", "owl", "tiger", "dolphin", "sparrow", "bison", "gecko", "whale", "yak", "raven"];
const COLORS = ["#e8d5c0", "#d6e4da", "#dde3ee", "#efd9d3", "#e6dff0", "#f1e3c2", "#d3e6e6", "#e9dccb", "#dfe8cf", "#f0dde4"];

const hash = (id: string) => parseInt(id.replace(/-/g, "").slice(0, 8), 16) >>> 0;

export const handle = (id: string) => {
  const n = hash(id);
  return `@${ADJ[n % 16]}-${ANIMAL[(n >>> 4) % 16]}-${id.replace(/-/g, "").slice(-2)}`;
};
export const avatarColor = (id: string) => COLORS[(hash(id) >>> 8) % COLORS.length];
export const initial = (id: string) => ANIMAL[(hash(id) >>> 4) % 16][0].toUpperCase();
