export function getFileIcon(mimeType) {
  if (!mimeType) return '📄'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📕'
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
  if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml')) return '📝'
  return '📄'
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function copyToClipboard(text, label, setCopied) {
  navigator.clipboard.writeText(text)
  setCopied(label)
  setTimeout(() => setCopied(null), 2000)
}
