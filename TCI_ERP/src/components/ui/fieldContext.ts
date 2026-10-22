/**
 * The id of the visible caption of the Field a control sits in.
 *
 * A Field is a <label> wrapping its control, which names the control
 * natively. A control that carries a button of its own inside the label
 * (PasswordInput's eye) would otherwise be named «Пароль Показать пароль»:
 * the label's text includes the button's name. Such a control points
 * `aria-labelledby` at the caption instead, which names it «Пароль» alone.
 */
import { createContext } from 'react'

export const FieldLabelIdContext = createContext<string | undefined>(undefined)
