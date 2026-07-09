// Unit tests for the notebook video-link parser.
// Runner: Node's built-in test runner — `npm test` (i.e. `node --test`). No extra deps.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl } from '../src/parseVideoUrl.js';

const iframe = (src) => ({ kind: 'iframe', src });
const video = (src) => ({ kind: 'video', src });

describe('YouTube', () => {
  const EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
  it('watch?v=', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), iframe(EMBED)));
  it('watch with extra params before v=', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ'), iframe(EMBED)));
  it('watch with trailing &t=', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), iframe(EMBED)));
  it('youtu.be short link', () => assert.deepEqual(
    parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'), iframe(EMBED)));
  it('youtu.be with query', () => assert.deepEqual(
    parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=10'), iframe(EMBED)));
  it('shorts/', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), iframe(EMBED)));
  it('embed/', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), iframe(EMBED)));
  it('live/', () => assert.deepEqual(
    parseVideoUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), iframe(EMBED)));
});

describe('Vimeo', () => {
  it('vimeo.com/<id>', () => assert.deepEqual(
    parseVideoUrl('https://vimeo.com/123456789'),
    iframe('https://player.vimeo.com/video/123456789')));
  it('vimeo.com/video/<id>', () => assert.deepEqual(
    parseVideoUrl('https://vimeo.com/video/123456789'),
    iframe('https://player.vimeo.com/video/123456789')));
});

describe('Dailymotion', () => {
  it('dailymotion.com/video/<id>', () => assert.deepEqual(
    parseVideoUrl('https://www.dailymotion.com/video/x7tgad0'),
    iframe('https://www.dailymotion.com/embed/video/x7tgad0')));
  it('dai.ly short link', () => assert.deepEqual(
    parseVideoUrl('https://dai.ly/x7tgad0'),
    iframe('https://www.dailymotion.com/embed/video/x7tgad0')));
});

describe('Loom', () => {
  it('share/', () => assert.deepEqual(
    parseVideoUrl('https://www.loom.com/share/abcdef123456'),
    iframe('https://www.loom.com/embed/abcdef123456')));
  it('embed/', () => assert.deepEqual(
    parseVideoUrl('https://www.loom.com/embed/abcdef123456'),
    iframe('https://www.loom.com/embed/abcdef123456')));
});

describe('Twitch', () => {
  it('videos/<id>', () => assert.deepEqual(
    parseVideoUrl('https://www.twitch.tv/videos/123456789'),
    iframe('https://player.twitch.tv/?video=123456789&parent=localhost&autoplay=false')));
});

describe('Direct video file', () => {
  for (const ext of ['mp4', 'webm', 'ogg', 'mov', 'm4v']) {
    const url = `https://example.com/clip.${ext}`;
    it(`.${ext}`, () => assert.deepEqual(parseVideoUrl(url), video(url)));
  }
  it('with query string', () => {
    const url = 'https://cdn.example.com/clip.mp4?token=abc123';
    assert.deepEqual(parseVideoUrl(url), video(url));
  });
});

describe('Uploaded video (auth proxy)', () => {
  it('/api/attachment proxy → playable <video>', () => {
    const url = '/api/attachment?u=' + encodeURIComponent('https://files.todoist.com/abc/clip.bin');
    assert.deepEqual(parseVideoUrl(url), video(url));
  });
});

describe('Fallback → null', () => {
  it('empty string', () => assert.equal(parseVideoUrl(''), null));
  it('null input', () => assert.equal(parseVideoUrl(null), null));
  it('undefined input', () => assert.equal(parseVideoUrl(undefined), null));
  it('whitespace only', () => assert.equal(parseVideoUrl('   '), null));
  it('plain non-video page', () => assert.equal(
    parseVideoUrl('https://example.com/article'), null));
  it('youtube home, no video id', () => assert.equal(
    parseVideoUrl('https://www.youtube.com/'), null));
  it('not a url', () => assert.equal(parseVideoUrl('just some text'), null));
  it('non-video file', () => assert.equal(
    parseVideoUrl('https://example.com/doc.pdf'), null));
});
