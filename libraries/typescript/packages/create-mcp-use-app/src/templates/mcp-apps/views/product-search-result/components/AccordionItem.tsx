export interface AccordionItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function AccordionItem({
  question,
  answer,
  isOpen,
  onToggle,
}: AccordionItemProps) {
  return (
    <div className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-700">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {question}
        </span>
        <span className="text-xl text-neutral-500 transition-transform duration-200 dark:text-neutral-400">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-neutral-600 dark:text-neutral-400">
          {answer}
        </div>
      )}
    </div>
  );
}
