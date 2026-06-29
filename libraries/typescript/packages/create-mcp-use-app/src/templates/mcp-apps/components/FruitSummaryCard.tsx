interface FruitSummaryCardProps {
  fruit: string;
  color: string;
  facts: string[];
}

export default function FruitSummaryCard({
  fruit,
  color,
  facts,
}: FruitSummaryCardProps) {
  return (
    <div className="rounded-3xl border border-default bg-surface-elevated p-6">
      <div className={`mb-4 rounded-2xl px-4 py-3 ${color}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-secondary">
          Inline JSX widget
        </p>
        <h2 className="heading-xl capitalize">{fruit}</h2>
      </div>
      <ul className="space-y-2">
        {facts.map((fact) => (
          <li key={fact} className="text-sm text-secondary">
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}
