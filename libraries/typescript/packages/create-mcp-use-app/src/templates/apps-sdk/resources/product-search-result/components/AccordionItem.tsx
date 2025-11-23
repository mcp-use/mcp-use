import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import React from "react";
import type { AccordionItemProps } from "../types";

export const AccordionItem: React.FC<AccordionItemProps> = ({
  question,
  answer,
  isOpen,
  onToggle,
}) => {
  return (
    <div className="border-b border-gray-200 dark:border-gray-800 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
      >
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {question}
        </span>
        <span className="text-xl text-gray-500 dark:text-gray-400 transition-transform duration-200">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      <Animate enter={{ y: 0, delay: 150, duration: 450 }} exit={{ y: -8 }}>
        {isOpen && (
          <div key="content" className="pb-4 text-secondary px-4">
            {answer}
          </div>
        )}
      </Animate>
    </div>
  );
};

