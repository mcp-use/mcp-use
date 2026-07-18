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
  if (html.includes("<head>")) {
    return html.replace("<head>", "<head>" + OPENAI_FILE_APIS_SCRIPT);
  }
  if (html.includes("<HEAD>")) {
    return html.replace("<HEAD>", "<HEAD>" + OPENAI_FILE_APIS_SCRIPT);
  }
  if (html.includes("<html>")) {
    return html.replace(
      "<html>",
      "<html><head>" + OPENAI_FILE_APIS_SCRIPT + "</head>"
    );
  }
  if (html.includes("<HTML>")) {
    return html.replace(
      "<HTML>",
      "<HTML><head>" + OPENAI_FILE_APIS_SCRIPT + "</head>"
    );
  }
  if (html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
    return html.replace(
      /(<!DOCTYPE[^>]*>|<!doctype[^>]*>)/i,
      "$1<head>" + OPENAI_FILE_APIS_SCRIPT + "</head>"
    );
  }
  return OPENAI_FILE_APIS_SCRIPT + html;
}
