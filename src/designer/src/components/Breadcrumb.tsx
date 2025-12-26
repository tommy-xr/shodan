interface BreadcrumbItem {
  name: string;
  path?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
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
    </nav>
  );
}
