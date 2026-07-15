import { cn } from "@/client/lib/utils";

interface NotFoundProps {
  message: string;
  className?: string;
  vertical?: boolean;
  noBorder?: boolean;
}

export function NotFound({
  message,
  className = "",
  vertical,
  noBorder,
}: NotFoundProps) {
  return (
    <div
      className={cn(`mt-2  rounded-md p-6 ${className}`, !noBorder && "border")}
    >
      <p
        className={cn(
          "text-sm text-muted-foreground flex items-center gap-4",
          vertical && "flex-col"
        )}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 500 500"
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          className="flex-shrink-0"
        >
          <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
            <g fillRule="nonzero" className="stroke-black dark:stroke-white" strokeWidth="20" fill="none">
              <path d="M105.933 0C164.437 0.000116002 211.865 47.607 211.865 106.333C211.865 131.829 210.493 158.403 221.068 181.602L228.975 198.947C243.584 230.997 269.265 256.7 301.303 271.336L316.155 278.121C340.142 289.079 367.694 287.335 394.066 287.335C452.571 287.335 499.999 334.942 499.999 393.668C499.999 452.394 452.571 500.001 394.066 500.001C335.562 500.001 288.134 452.394 288.134 393.668C288.134 368.974 289.24 343.275 278.992 320.807L270.586 302.38C255.948 270.29 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.86252e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z" />
              <circle cx="100.426" cy="399.575" r="100.426" />
              <path d="M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z" />
            </g>
          </g>
        </svg>
        {message}
      </p>
    </div>
  );
}
