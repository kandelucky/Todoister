// Parse a pasted video link into an embed descriptor.
//
// Pure function — no DOM/React dependencies — so it can be unit-tested directly
// with `node:test` (see ../test/parseVideoUrl.test.js). main.jsx imports it.
//
// Returns:
//   { kind: 'iframe', src } — providers that embed via <iframe>
//   { kind: 'video',  src } — a direct video-file URL played via <video>
//   null                    — empty / unknown / non-video link
export function parseVideoUrl(raw) {
  const u = (raw || '').trim();
  let m;
  // An uploaded video plays through our auth proxy (/api/attachment?u=…). The path carries no
  // file extension, so match the proxy itself and treat it as a directly-playable <video>.
  if (/^\/api\/attachment\?u=/.test(u)) return { kind: 'video', src: u };
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i)))
    return { kind: 'iframe', src: `https://www.youtube.com/embed/${m[1]}` };
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i)))
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if ((m = u.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-z0-9]+)/i)))
    return { kind: 'iframe', src: `https://www.dailymotion.com/embed/video/${m[1]}` };
  if ((m = u.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i)))
    return { kind: 'iframe', src: `https://www.loom.com/embed/${m[1]}` };
  if ((m = u.match(/twitch\.tv\/videos\/(\d+)/i)))
    return { kind: 'iframe', src: `https://player.twitch.tv/?video=${m[1]}&parent=localhost&autoplay=false` };
  if (/^https?:\/\/\S+\.(mp4|webm|ogg|ogv|mov|m4v)(\?\S*)?$/i.test(u))
    return { kind: 'video', src: u };
  return null;
}
