import { useState } from "react";
import { AccordionItem } from "./AccordionItem.js";

export interface AccordionItemData {
  question: string;
  answer: string;
}

interface AccordionProps {
  items: AccordionItemData[];
}

export function Accordion({ items }: AccordionProps) {
  const [openAccordionIndex, setOpenAccordionIndex] = useState<number | null>(
    null
  );

  return (
    <div className="mt-4 border-t border-neutral-200 p-8 pt-4 dark:border-neutral-700">
      <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
        {items.map((item, index) => (
          <AccordionItem
            key={index}
            question={item.question}
            answer={item.answer}
            isOpen={openAccordionIndex === index}
            onToggle={() =>
              setOpenAccordionIndex(openAccordionIndex === index ? null : index)
            }
          />
        ))}
      </div>
    </div>
  );
}
