/**
 * A navigation that looks like a button. An <a> may not wrap a <button>
 * (two interactive elements, two tab stops, invalid HTML), so a button that
 * goes somewhere is a Link with the button's look.
 */

import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

import { buttonClassName } from './buttonStyles'
import type { ButtonVariant } from './buttonStyles'

interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
}

export function LinkButton({ variant = 'primary', size = 'md', className = '', ...rest }: LinkButtonProps) {
  return <Link className={buttonClassName(variant, size, className)} {...rest} />
}
