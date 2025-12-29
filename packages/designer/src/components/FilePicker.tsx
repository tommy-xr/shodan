import { useState, useEffect, useCallback } from 'react';
import { listFiles, searchFiles, type FileEntry } from '../lib/api';

interface FilePickerProps {
  rootDirectory: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  filter?: string; // e.g., "*.md" or "*.sh"
}

export function FilePicker({ rootDirectory, onSelect, onClose, filter }: FilePickerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);

  const loadFiles = useCallback(async (path: string) => {
    if (!rootDirectory) {
      setError('No root directory set');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSearchResults(null);

    try {
      const response = await listFiles(rootDirectory, path);
      setFiles(response.files);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [rootDirectory]);

  useEffect(() => {
    loadFiles('');
  }, [loadFiles]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !rootDirectory) return;

    setSearching(true);
    setError(null);

    try {
      const pattern = `**/*${searchQuery}*`;
      const response = await searchFiles(rootDirectory, pattern);
      setSearchResults(response.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
    if (e.key === 'Escape') {
      if (searchResults) {
        setSearchResults(null);
        setSearchQuery('');
      } else {
        onClose();
      }
    }
  };

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      loadFiles(entry.path);
    } else {
      onSelect(entry.path);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const newPath = parts.slice(0, index).join('/');
    loadFiles(newPath);
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  // Filter files if filter prop is provided
  const filteredFiles = filter
    ? files.filter(f => f.type === 'directory' || matchFilter(f.name, filter))
    : files;

  return (
    <div className="file-picker-overlay" onClick={onClose}>
      <div className="file-picker" onClick={(e) => e.stopPropagation()}>
        <div className="file-picker-header">
          <h3>Select File</h3>
          <button className="file-picker-close" onClick={onClose}>×</button>
        </div>

        <div className="file-picker-search">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files..."
            autoFocus
          />
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
            {searching ? '...' : 'Search'}
          </button>
        </div>

        <div className="file-picker-breadcrumb">
          <span className="breadcrumb-item" onClick={() => loadFiles('')}>
            {rootDirectory.split('/').pop() || 'root'}
          </span>
          {pathParts.map((part, index) => (
            <span key={index}>
              <span className="breadcrumb-separator">/</span>
              <span
                className="breadcrumb-item"
                onClick={() => handleBreadcrumbClick(index + 1)}
              >
                {part}
              </span>
            </span>
          ))}
        </div>

        <div className="file-picker-content">
          {loading && <div className="file-picker-loading">Loading...</div>}
          {error && <div className="file-picker-error">{error}</div>}

          {!loading && !error && searchResults && (
            <div className="file-picker-results">
              <div className="file-picker-results-header">
                <span>Search results ({searchResults.length})</span>
                <button onClick={() => { setSearchResults(null); setSearchQuery(''); }}>
                  Clear
                </button>
              </div>
              {searchResults.length === 0 ? (
                <div className="file-picker-empty">No files found</div>
              ) : (
                searchResults.map((filePath) => (
                  <div
                    key={filePath}
                    className="file-picker-entry file"
                    onClick={() => onSelect(filePath)}
                  >
                    <span className="file-icon">📄</span>
                    <span className="file-name">{filePath}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {!loading && !error && !searchResults && (
            <>
              {currentPath && (
                <div
                  className="file-picker-entry directory"
                  onClick={() => handleBreadcrumbClick(pathParts.length - 1)}
                >
                  <span className="file-icon">📁</span>
                  <span className="file-name">..</span>
                </div>
              )}
              {filteredFiles.length === 0 ? (
                <div className="file-picker-empty">No files in this directory</div>
              ) : (
                filteredFiles.map((entry) => (
                  <div
                    key={entry.path}
                    className={`file-picker-entry ${entry.type}`}
                    onClick={() => handleEntryClick(entry)}
                  >
                    <span className="file-icon">
                      {entry.type === 'directory' ? '📁' : '📄'}
                    </span>
                    <span className="file-name">{entry.name}</span>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function matchFilter(filename: string, filter: string): boolean {
  // Simple glob matching for *.ext patterns
  if (filter.startsWith('*.')) {
    const ext = filter.slice(1); // Get ".ext"
    return filename.endsWith(ext);
  }
  return filename.includes(filter);
}
