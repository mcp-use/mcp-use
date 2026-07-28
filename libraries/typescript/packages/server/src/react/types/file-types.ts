/** Opaque file reference returned by {@link useFiles}. */
export type FileMetadata = {
  /** Host-assigned opaque file identifier. */
  fileId: string;
};

/** Value returned by {@link useFiles}. */
export interface UseFilesResult {
  /** Whether the ChatGPT file upload and download extensions are available. */
  isSupported: boolean;
  /** Upload a file through ChatGPT. */
  upload(file: File): Promise<FileMetadata>;
  /** Request a temporary download URL for an uploaded file. */
  getDownloadUrl(file: FileMetadata): Promise<{
    /** Temporary URL from which the file can be downloaded. */
    downloadUrl: string;
  }>;
}
