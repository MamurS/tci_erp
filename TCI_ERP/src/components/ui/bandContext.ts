import { createContext } from 'react'

/** True inside a HeroBand: a primary button there turns white with navy text,
 * so it stands out on the navy band instead of disappearing into it. */
export const OnBandContext = createContext(false)
