interface RequestActionToastAction {
  label: string;
  testId: string;
  onClick: () => void;
}

interface RequestActionToastProps {
  title: string;
  description: React.ReactNode;
  extra?: React.ReactNode;
  actions: RequestActionToastAction[];
}

export function RequestActionToast({
  title,
  description,
  extra,
  actions,
}: RequestActionToastProps) {
  return (
    <div className="space-y-3">
      <div>
        <strong>{title}</strong>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
        {extra}
      </div>
      <div className="flex gap-2 flex-wrap">
        {actions.map((action) => (
          <button
            key={action.testId}
            data-testid={action.testId}
            className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
