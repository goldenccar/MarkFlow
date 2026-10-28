import type { SelectHTMLAttributes } from 'react'
import { Icon } from './Icons'
import './select-control.css'

/** Keep native selection and keyboard behavior; draw one consistent, inset indicator. */
export default function SelectControl({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={`select-control ${className}`} data-disabled={props.disabled || undefined}>
    <select {...props}>{children}</select>
    <Icon name="chevronDown" size={14} />
  </span>
}
