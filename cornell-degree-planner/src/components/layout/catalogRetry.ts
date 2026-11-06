/** Reload the whole page. A tab opened before a deploy keeps running the old
 *  bundle, and refetching inside it fails the same way every time (an older
 *  schema can reject data written for the newer one), so retry means reload:
 *  that is what fetches the current build. Plans are saved, so nothing is lost. */
export function retryCatalogLoad(reload: () => void = () => window.location.reload()): void {
  reload();
}
