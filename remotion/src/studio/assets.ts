// Asset paths in a timeline (idea from OpenMontage's resolveAsset, AGPL-3.0, rewritten here):
//   https://... or data:...      -> used as is (stock footage, uploads hosted elsewhere)
//   library/... or projects/...  -> under media/ (Remotion's public dir)
//   anything else (assets/x.jpg) -> this project's folder: media/projects/<id>/assets/x.jpg
import { staticFile } from 'remotion';

export const isRemote = (src: string) => /^(https?:|data:|blob:)/.test(src);

/** Path relative to media/ (what staticFile() takes), or the URL itself when remote. */
export function publicPath(src: string, projectId: string): string {
  if (isRemote(src)) return src;
  const clean = src.replace(/^\/+/, '');
  if (/^(library|projects)\//.test(clean)) return clean;
  return `projects/${projectId}/${clean}`;
}

export function url(src: string | undefined, projectId: string): string {
  if (!src) return '';
  const p = publicPath(src, projectId);
  return isRemote(p) ? p : staticFile(p);
}
