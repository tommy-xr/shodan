interface BreadcrumbItem {
  name: string;
  path?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
  onSave?: () => void;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
}

export function Breadcrumb({ items, onNavigate, onSave, isSaving, hasUnsavedChanges }: BreadcrumbProps) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <nav className="breadcrumb">
      {items.map((item, index) => (
        <span key={index} className="breadcrumb-item">
          {index > 0 && <span className="breadcrumb-separator">/</span>}
          {index === items.length - 1 ? (
            <span className="breadcrumb-current">{item.name}</span>
          ) : (
            <button
              className="breadcrumb-link"
              onClick={() => onNavigate(index)}
            >
              {item.name}
            </button>
          )}
        </span>
      ))}
      {onSave && (
        <button
          className={`breadcrumb-save ${hasUnsavedChanges ? 'has-changes' : ''}`}
          onClick={onSave}
          disabled={isSaving}
          title={hasUnsavedChanges ? 'Save changes' : 'No changes to save'}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      )}
    </nav>
  );
}
