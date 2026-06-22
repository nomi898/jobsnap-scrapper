export default function FieldHint({ label = 'More information', variant = 'info', children }) {
  return (
    <span className={`field-hint field-hint-${variant}`}>
      <button
        type="button"
        className="field-hint-trigger"
        aria-label={label}
      >
        {variant === 'alert' ? '!' : 'i'}
      </button>
      <span className="field-hint-tooltip" role="tooltip">
        {children}
      </span>
    </span>
  )
}
