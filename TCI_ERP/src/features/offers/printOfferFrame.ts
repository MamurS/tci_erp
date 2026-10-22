/** Opens the browser's print dialog for the frame (the user picks «Save as
 * PDF»). Waits for the document's fonts, so the PDF never falls back to a
 * system face. */
export async function printOfferFrame(frame: HTMLIFrameElement | null): Promise<void> {
  const win = frame?.contentWindow
  if (!win) throw new Error('The offer frame is not ready')
  await frame?.contentDocument?.fonts?.ready
  win.print()
}
