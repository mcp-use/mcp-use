const OPENAI_FILE_APIS_SCRIPT = `<script>
(function () {
  var files = new Map();
  window.openai = window.openai || {};
  window.openai.uploadFile = async function (file) {
    var fileId = crypto.randomUUID();
    files.set(fileId, file);
    return { fileId: fileId };
  };
  window.openai.getFileDownloadUrl = async function (ref) {
    var file = files.get(ref.fileId);
    if (!file) {
      throw new Error("File not found: " + ref.fileId);
    }
    return { downloadUrl: URL.createObjectURL(file) };
  };
})();
</script>`;

/**
 * Prepend ChatGPT-style file helpers so `useFiles()` works in dev hosts
 * (inspector) before the view bundle calls `bootstrapView`.
 */
export function injectOpenAiFileApis(html: string): string {
  const headEnd = findOpeningConstructEnd(html, "<head");
  if (headEnd !== undefined) {
    return insertAt(html, headEnd, OPENAI_FILE_APIS_SCRIPT);
  }
  const htmlEnd = findOpeningConstructEnd(html, "<html");
  if (htmlEnd !== undefined) {
    return insertAt(
      html,
      htmlEnd,
      "<head>" + OPENAI_FILE_APIS_SCRIPT + "</head>"
    );
  }
  const doctypeEnd = findOpeningConstructEnd(html, "<!doctype");
  if (doctypeEnd !== undefined) {
    return insertAt(
      html,
      doctypeEnd,
      "<head>" + OPENAI_FILE_APIS_SCRIPT + "</head>"
    );
  }
  return OPENAI_FILE_APIS_SCRIPT + html;
}

function findOpeningConstructEnd(
  html: string,
  lowercasePrefix: string
): number | undefined {
  const lowercaseHtml = html.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lowercaseHtml.length) {
    const start = lowercaseHtml.indexOf(lowercasePrefix, searchFrom);
    if (start === -1) return undefined;
    const boundary = lowercaseHtml[start + lowercasePrefix.length];
    if (
      boundary === ">" ||
      boundary === " " ||
      boundary === "\t" ||
      boundary === "\n" ||
      boundary === "\r" ||
      boundary === "\f"
    ) {
      let quote: '"' | "'" | undefined;
      for (
        let index = start + lowercasePrefix.length;
        index < html.length;
        index++
      ) {
        const character = html[index];
        if (quote) {
          if (character === quote) quote = undefined;
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === ">") return index + 1;
      }
      return undefined;
    }
    searchFrom = start + lowercasePrefix.length;
  }
  return undefined;
}

function insertAt(value: string, index: number, addition: string): string {
  return value.slice(0, index) + addition + value.slice(index);
}
