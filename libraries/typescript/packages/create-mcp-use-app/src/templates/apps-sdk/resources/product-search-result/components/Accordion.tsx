import React, { useState } from "react";
import { AccordionItem } from "./AccordionItem";

export interface AccordionItemData {
  question: string;
  answer: string;
}

interface AccordionProps {
  items: AccordionItemData[];
  title?: string;
}

export const Accordion: React.FC<AccordionProps> = ({
  items,
  title = "Can fruit be cute?",
}) => {
  const [openAccordionIndex, setOpenAccordionIndex] = useState<number | null>(
    null
  );

  return (
    <div className="p-8 pt-4 border-t border-gray-200 dark:border-gray-800 mt-4">
      <h3 className="heading-lg mb-4">{title}</h3>
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
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
};
