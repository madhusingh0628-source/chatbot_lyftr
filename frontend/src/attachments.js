// Reading user files in the browser. Nothing is uploaded until the message is sent.

export const MAX_MESSAGE = 4000;           // backend limit (after trimming)
export const MAX_IMAGES = 3;               // backend limit
const MAX_TEXT_FILE_BYTES = 200_000;
const IMAGE_MAX_SIDE = 1024;               // big enough for vision models to read text; ~150 KB as JPEG
const MAX_IMAGE_INPUT_BYTES = 25_000_000;  // refuse absurdly large originals before decoding

export const TEXT_EXTENSIONS = [
  "txt", "md", "csv", "tsv", "json", "log", "py", "js", "jsx", "ts", "tsx", "html", "css", "scss",
  "xml", "yaml", "yml", "toml", "ini", "sql", "java", "kt", "c", "h", "cpp", "hpp", "cs", "go",
  "rs", "rb", "php", "swift", "sh", "ps1", "bat", "env", "dockerfile",
];
const TEXT_EXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join("|")})$`, "i");
export const ACCEPT = `image/png,image/jpeg,image/gif,image/webp,${TEXT_EXTENSIONS.map((e) => "." + e).join(",")}`;

let nextAttachmentId = 1;

export function isImage(file) {
  return file.type.startsWith("image/") && file.type !== "image/svg+xml";
}

export function isTextFile(file) {
  return file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name);
}

/** Length the backend will see: Python counts code points, JS .length counts UTF-16 units. */
export function charCount(text) {
  let n = 0;
  for (const _ of text) n++;   // eslint-disable-line no-unused-vars
  return n;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Text file -> {id, kind:"text", name, size, text} */
export async function readTextFile(file) {
  if (file.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`${file.name} is too large (${formatBytes(file.size)}; max 200 KB).`);
  }
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error(`${file.name} looks like a binary file, not text.`);
  return { id: nextAttachmentId++, kind: "text", name: file.name, size: file.size, text };
}

/** Image file -> {id, kind:"image", name, size, dataUrl}  (downscaled JPEG via <canvas>) */
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      reject(new Error(`${file.name} is too large (${formatBytes(file.size)}).`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      // JPEG has no alpha: paint white first, otherwise transparent PNGs turn black
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      resolve({ id: nextAttachmentId++, kind: "image", name: file.name, size: Math.round(dataUrl.length * 0.75), dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} is not a readable image.`)); };
    img.src = url;
  });
}

/** Text that will actually be sent: the typed message plus any attached text files. */
export function composeMessage(typed, attachments) {
  const files = attachments.filter((a) => a.kind === "text");
  if (!files.length) return typed;
  const blocks = files.map((f) => `--- file: ${f.name} ---\n${f.text}\n--- end of ${f.name} ---`);
  const question = typed.trim() || "Please summarise the attached file(s).";
  return `${blocks.join("\n\n")}\n\n${question}`;
}

const FILE_BLOCK = /--- file: (.+?) ---\n([\s\S]*?)\n--- end of \1 ---\n*/g;
const IMAGE_MARKER = /\n?\[(\d+) image\(s\) attached\]\s*$/;

/** Reverse of composeMessage for messages loaded from history: split file blocks and the
 *  stored "[n image(s) attached]" marker out of the text so they render as chips. */
export function parseStoredUserMessage(content) {
  const files = [];
  let text = content.replace(FILE_BLOCK, (_, name, body) => {
    files.push({ id: nextAttachmentId++, kind: "text", name, size: new Blob([body]).size, text: body });
    return "";
  });
  let imageCount = 0;
  text = text.replace(IMAGE_MARKER, (_, n) => { imageCount = Number(n); return ""; });
  return { text: text.trim(), files, imageCount, resend: content.replace(IMAGE_MARKER, "").trim() };
}
