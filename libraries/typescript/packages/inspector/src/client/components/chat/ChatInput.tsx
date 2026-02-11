import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { cn } from "@/client/lib/utils";
import { Image as ImageIcon, Paperclip, X } from "lucide-react";
import React, { useRef } from "react";
import type { MessageAttachment } from "./types";
import { formatFileSize } from "./utils";

interface ChatInputProps {
  inputValue: string;
  isConnected: boolean;
  isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  attachments: MessageAttachment[];
  placeholder?: string;
  className?: string;
  showAttachButton?: boolean;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: () => void;
  onAttachmentAdd: (file: File) => void;
  onAttachmentRemove: (index: number) => void;
}

export function ChatInput({
  inputValue,
  isConnected,
  isLoading,
  textareaRef,
  attachments,
  placeholder = "Ask a question",
  className,
  showAttachButton = true,
  onInputChange,
  onKeyDown,
  onKeyUp,
  onClick,
  onAttachmentAdd,
  onAttachmentRemove,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        onAttachmentAdd(files[i]);
      }
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const hasAttachments = attachments.length > 0;

  return (
    <div className="relative w-full">
      {/* Attachment Previews */}
      {hasAttachments && (
        <div className="absolute top-0 left-0 right-0 z-20 p-3 flex gap-2 flex-wrap">
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className="relative group bg-zinc-100/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded-lg p-2 flex items-center gap-2 border border-zinc-200 dark:border-zinc-700"
              data-testid={`chat-attachment-${index}`}
            >
              <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium truncate max-w-[150px]">
                  {attachment.name || "Image"}
                </span>
                {attachment.size && (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.size)}
                  </span>
                )}
              </div>
              <button
                onClick={() => onAttachmentRemove(index)}
                className="shrink-0 p-1 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                title="Remove attachment"
                type="button"
                data-testid={`chat-attachment-remove-${index}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={onClick}
        placeholder={isConnected ? placeholder : "Server not connected"}
        className={cn(
          "p-4 min-h-[150px] max-h-[300px] rounded-xl",
          hasAttachments && "pt-20",
          className
        )}
        disabled={!isConnected || isLoading}
        data-testid="chat-input"
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        aria-label="Upload images"
      />

      {/* Attach button (positioned by parent) */}
      {showAttachButton && (
        <div className="absolute left-0 p-3 bottom-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected || isLoading}
            className="h-auto w-auto aspect-square rounded-full p-2"
            title="Attach images"
            type="button"
            data-testid="chat-attach-button"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
