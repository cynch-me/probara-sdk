/**
 * The recording controller with fakes of what only a browser has: the shared screen, the video
 * recorder and the captures. The intake is a fake of its client, recording every call.
 */
import {
  type RecordingSession,
  type VideoRecorder,
  type VideoRecorderOptions,
  type VideoRecordingResult,
  type VideoStopReason,
} from '@probara/vis-capture';
import { describe, expect, it } from 'vitest';
import {
  createRecordingController,
  type ControllerDeps,
  type RecorderState,
} from './controller.js';
import {
  IntakeError,
  widgetRefusalOf,
  type Intake,
  type RecordingLink,
  type Submission,
  type SubmissionStart,
} from './intake.js';

const LINK: RecordingLink = {
  organizationName: 'Acme',
  title: 'Checkout bug',
  reference: null,
  folder: null,
  microphone: true,
  recordingMaxMinutes: 30,
  expiresAt: null,
};
const MAX_MS = 30 * 60_000;

type Step =
  'readLink' | 'start' | 'createUpload' | 'putPart' | 'complete' | 'putAsset' | 'finalize';

/** A fake intake: `failures` makes the named call fail with the given error. */
function fakeIntake(link: RecordingLink = LINK, failures: Partial<Record<Step, Error>> = {}) {
  const calls: string[] = [];
  const started: SubmissionStart[] = [];
  const parts: [number, string][] = [];
  /** The bytes of every part, in the order they were sent. */
  const partBytes: Uint8Array[] = [];
  const assets: string[] = [];
  const finalized: number[] = [];
  const aborts: { keepalive: boolean }[] = [];
  const check = (step: Step): void => {
    calls.push(step);
    const failure = failures[step];
    if (failure !== undefined) throw failure;
  };
  const submission: Submission = {
    visUlid: '01JVIS',
    createUpload(contentType) {
      check('createUpload');
      calls.push(contentType);
      return Promise.resolve({ uploadUlid: '01JUP', partSize: 4, maxBytes: 100 });
    },
    async putPart(uploadUlid, partNumber, part) {
      check('putPart');
      partBytes.push(new Uint8Array(await part.arrayBuffer()));
      parts.push([partNumber, await part.text()]);
    },
    complete() {
      check('complete');
      return Promise.resolve();
    },
    putAsset(kind) {
      check('putAsset');
      assets.push(kind);
      return Promise.resolve();
    },
    finalize(durationMs) {
      check('finalize');
      finalized.push(durationMs);
      return Promise.resolve();
    },
    abort(options = {}) {
      aborts.push({ keepalive: options.keepalive === true });
      return Promise.resolve();
    },
  };
  const intake: Intake = {
    prefix: 'https://app.example.com/api/v1/public/vis-recording/',
    readLink() {
      try {
        check('readLink');
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('refused'));
      }
      return Promise.resolve(link);
    },
    start(body) {
      try {
        check('start');
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('refused'));
      }
      started.push(body);
      return Promise.resolve(submission);
    },
  };
  return { intake, calls, started, parts, partBytes, assets, finalized, aborts };
}

/** A fake video recorder: the test emits chunks and ends it. */
function fakeVideo() {
  let resolve: (result: VideoRecordingResult) => void = () => undefined;
  const result = new Promise<VideoRecordingResult>((done) => {
    resolve = done;
  });
  let state: VideoRecorder['state'] = 'inactive';
  let options: VideoRecorderOptions = {};
  let index = 0;
  const actions: string[] = [];
  /** The recorded time the next end reports. */
  let durationMs = 4000;
  const end = (reason: VideoStopReason, duration = durationMs, sinkError?: unknown): void => {
    if (state === 'stopped') return;
    state = 'stopped';
    const out: VideoRecordingResult = {
      mimeType: 'video/webm;codecs=vp9,opus',
      container: 'webm',
      videoCodec: 'vp9',
      size: 0,
      durationMs: duration,
      reason,
      chunks: index,
    };
    if (sinkError !== undefined) out.sinkError = sinkError;
    resolve(out);
  };
  const recorder: VideoRecorder = {
    get state() {
      return state;
    },
    format: {
      mimeType: 'video/webm;codecs=vp9,opus',
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    },
    result,
    start() {
      actions.push('start');
      state = 'recording';
    },
    pause() {
      actions.push('pause');
      state = 'paused';
    },
    resume() {
      actions.push('resume');
      state = 'recording';
    },
    stop() {
      actions.push('stop');
      end('stopped');
      return result;
    },
  };
  return {
    recorder,
    actions,
    get options() {
      return options;
    },
    setOptions(value: VideoRecorderOptions) {
      options = value;
    },
    setDuration(value: number) {
      durationMs = value;
    },
    async emit(data: string | Uint8Array<ArrayBuffer>) {
      await options.sink?.(new Blob([data]), index);
      index += 1;
    },
    end,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface Setup {
  intake?: ReturnType<typeof fakeIntake>;
  refusalOf?: ControllerDeps['refusalOf'];
  acquire?: ControllerDeps['acquireMedia'];
  query?: ControllerDeps['query'];
  crossOrigin?: boolean;
}

function setUp(setup: Setup = {}) {
  const intake = setup.intake ?? fakeIntake();
  // One video recorder per recording, as the engine makes.
  let video = fakeVideo();
  const states: RecorderState[] = [];
  const log: string[] = [];
  let monotonic = 1000;
  let session: RecordingSession | undefined;
  const deps: ControllerDeps = {
    intake: intake.intake,
    query: setup.query ?? {},
    crossOrigin: setup.crossOrigin ?? false,
    acquireMedia:
      setup.acquire ??
      ((options) => {
        log.push(`acquire microphone=${String(options.microphone)}`);
        return Promise.resolve({
          stream: {} as MediaStream,
          release: () => log.push('release'),
        });
      }),
    createVideoRecorder(_stream, options) {
      if (video.recorder.state === 'stopped') video = fakeVideo();
      video.setOptions(options);
      return video.recorder;
    },
    startCaptures(recording) {
      session = recording;
      log.push('captures started');
      return { stop: () => log.push('captures stopped') };
    },
    collectEnvironment: () =>
      Promise.resolve({
        pageUrl: 'https://shop.example.com/cart',
        pageTitle: 'Cart',
        environment: { browser: { name: 'Chrome', version: '131' } },
      }),
    collectMetadata: () => ({ user: 'u-1' }),
    gzip: (entries) =>
      Promise.resolve(new Uint8Array(new TextEncoder().encode(JSON.stringify(entries)))),
    epoch: () => 1_767_225_600_000,
    monotonic: () => monotonic,
    onChange: (snapshot) => {
      if (states.at(-1) !== snapshot.state) states.push(snapshot.state);
    },
  };
  if (setup.refusalOf !== undefined) deps.refusalOf = setup.refusalOf;
  const controller = createRecordingController(deps);
  return {
    controller,
    intake,
    get video() {
      return video;
    },
    states,
    log,
    session: () => session,
    advance(ms: number) {
      monotonic += ms;
    },
  };
}

async function recording(setup: Setup = {}) {
  const t = setUp(setup);
  await t.controller.load();
  void t.controller.record();
  await flush();
  return t;
}

describe('the recording controller: the link', () => {
  it('shows the link with its title and microphone default, ready to record', async () => {
    const { controller, states } = setUp();
    await controller.load();
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      link: LINK,
      title: 'Checkout bug',
      microphone: true,
      maxDurationMs: MAX_MS,
    });
    expect(states).toEqual(['loading', 'ready']);
  });

  it('tells an unavailable link, a busy one and a failure apart', async () => {
    const outcomes: RecorderState[] = [];
    for (const failure of [
      new IntakeError(404, 'not_found'),
      new IntakeError(429, 'too_many_requests'),
      new IntakeError(null, 'network'),
    ]) {
      const { controller } = setUp({ intake: fakeIntake(LINK, { readLink: failure }) });
      await controller.load();
      outcomes.push(controller.snapshot().state);
    }
    const { controller } = setUp({ intake: fakeIntake({ ...LINK, recordingMaxMinutes: 0 }) });
    await controller.load();
    outcomes.push(controller.snapshot().state);
    // A folder override that names a private or unknown folder.
    const refused = setUp({
      intake: fakeIntake(LINK, { readLink: new IntakeError(422, 'validation_failed') }),
      query: { folder: '01JPRIVATE' },
    });
    await refused.controller.load();
    outcomes.push(refused.controller.snapshot().state);
    expect(outcomes).toEqual(['unavailable', 'busy', 'failed', 'unavailable', 'unavailable']);
  });
});

describe('the recording controller: a finished recording', () => {
  it('records, uploads the video in parts as it records, the diagnostics, and finalizes', async () => {
    const t = setUp({ query: { reference: 'SUP-9', folder: '01JFOLDER' } });
    await t.controller.load();
    t.controller.setMicrophone(false);
    void t.controller.record();
    await flush();

    expect(t.controller.snapshot().state).toBe('recording');
    expect(t.intake.started).toEqual([
      {
        title: 'Checkout bug',
        reference: 'SUP-9',
        folderUlid: '01JFOLDER',
        pageUrl: 'https://shop.example.com/cart',
        pageTitle: 'Cart',
        environment: { browser: { name: 'Chrome', version: '131' } },
        capturedAt: 1_767_225_600_000,
        metadata: { user: 'u-1' },
      },
    ]);
    expect(t.intake.calls.slice(0, 4)).toEqual(['readLink', 'start', 'createUpload', 'video/webm']);
    expect(t.video.options.maxDurationMs).toBe(MAX_MS);

    t.session()?.record('console', { t: 0, ts: 1, level: 'log', args: ['hello'] });
    await t.video.emit('abcdef');
    await flush();
    expect(t.intake.parts).toEqual([[1, 'abcd']]);
    await t.video.emit('gh');
    t.video.setDuration(4321);
    await t.controller.stop();
    await flush();
    await t.controller.send();
    await flush();

    expect(t.intake.parts).toEqual([
      [1, 'abcd'],
      [2, 'efgh'],
    ]);
    expect(t.intake.assets).toEqual(['console']);
    expect(t.intake.finalized).toEqual([4321]);
    expect(t.intake.aborts).toEqual([]);
    expect(t.states).toEqual([
      'loading',
      'ready',
      'starting',
      'recording',
      'review',
      'sending',
      'done',
    ]);
    expect(t.log).toEqual([
      'acquire microphone=false',
      'captures started',
      'captures stopped',
      'release',
    ]);
  });

  it('never reports more than the limit for a recording stopped at it', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    // The engine's timer fired a few milliseconds late.
    t.video.end('max_duration', MAX_MS + 7);
    await flush();
    await t.controller.send();
    await flush();
    expect(t.intake.finalized).toEqual([MAX_MS]);
    expect(t.controller.snapshot().state).toBe('done');
  });

  it('finishes normally when the visitor stops sharing from the browser', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    t.video.end('track_ended', 1500);
    await flush();
    await t.controller.send();
    await flush();
    expect(t.intake.finalized).toEqual([1500]);
    expect(t.controller.snapshot().state).toBe('done');
  });

  it('times the diagnostics against the video: paused time does not count', async () => {
    const t = await recording();
    t.advance(1000);
    t.controller.pause();
    expect(t.controller.snapshot().state).toBe('paused');
    t.advance(5000);
    t.controller.resume();
    t.advance(500);
    expect(t.session()?.stamp().t).toBe(1500);
    expect(t.controller.elapsedMs()).toBe(1500);
    expect(t.video.actions).toEqual(['start', 'pause', 'resume']);
  });
});

describe('the recording controller: the size limit', () => {
  // The fake upload allows 100 bytes in parts of 4.
  it('stops and sends the recording one part before the size limit, saying why', async () => {
    const t = await recording();
    await t.video.emit('x'.repeat(90));
    await flush();
    expect(t.video.actions).not.toContain('stop');
    await t.video.emit('x'.repeat(6));
    await flush();
    expect(t.video.actions).toContain('stop');
    expect(t.controller.snapshot()).toMatchObject({ state: 'review', stopReason: 'size_limit' });
    await t.controller.send();
    await flush();
    expect(t.intake.finalized).toHaveLength(1);
    expect(t.intake.aborts).toEqual([]);
    expect(t.intake.parts.reduce((sum, [, text]) => sum + text.length, 0)).toBe(96);
    expect(t.controller.snapshot()).toMatchObject({ state: 'done', stopReason: 'size_limit' });
    expect(t.states).toEqual([
      'loading',
      'ready',
      'starting',
      'recording',
      'review',
      'sending',
      'done',
    ]);
  });

  it('says the time limit stopped a recording, and nothing for one the visitor stopped', async () => {
    const timed = await recording();
    await timed.video.emit('abcd');
    timed.video.end('max_duration', MAX_MS);
    await flush();
    await timed.controller.send();
    await flush();
    expect(timed.controller.snapshot()).toMatchObject({ state: 'done', stopReason: 'time_limit' });

    const stopped = await recording();
    await stopped.video.emit('abcd');
    await stopped.controller.stop();
    await flush();
    await stopped.controller.send();
    await flush();
    expect(stopped.controller.snapshot()).toMatchObject({ state: 'done', stopReason: null });
  });
});

describe('the recording controller: every other ending aborts the submission', () => {
  it('discard aborts and lets the visitor record again', async () => {
    const t = await recording();
    await t.video.emit('abcdef');
    await t.controller.discard();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.intake.finalized).toEqual([]);
    expect(t.controller.snapshot().state).toBe('ready');
    expect(t.log).toContain('release');
    expect(t.log).toContain('captures stopped');
  });

  it('a part the intake refuses aborts the recording', async () => {
    const t = await recording({
      intake: fakeIntake(LINK, { putPart: new IntakeError(404, 'not_found') }),
    });
    await t.video.emit('abcd');
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.video.actions).toContain('stop');
    expect(t.intake.finalized).toEqual([]);
    expect(t.controller.snapshot().state).toBe('failed');
    expect(t.log).toContain('release');
  });

  it('a failure to open the upload right after the start aborts the submission', async () => {
    const t = await recording({
      intake: fakeIntake(LINK, { createUpload: new IntakeError(500, null) }),
    });
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.controller.snapshot().state).toBe('failed');
    expect(t.log).toContain('release');
  });

  it('a refusal at finalize aborts the submission', async () => {
    const t = await recording({
      intake: fakeIntake(LINK, {
        finalize: new IntakeError(422, 'validation_failed', 'recording_too_long'),
      }),
    });
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    await t.controller.send();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.controller.snapshot().state).toBe('failed');
  });

  it('a failed recorder aborts the submission', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    t.video.end('error');
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.intake.finalized).toEqual([]);
    expect(t.controller.snapshot().state).toBe('failed');
  });

  it('the page unloading aborts with a request that outlives the page', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    t.controller.pageHidden();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: true }]);
    expect(t.intake.finalized).toEqual([]);
    expect(t.controller.snapshot().state).toBe('closed');
    expect(t.log).toContain('captures stopped');
    expect(t.log).toContain('release');
  });

  it('closing while the submission is being started aborts it once it exists', async () => {
    const base = fakeIntake();
    let answer: () => void = () => undefined;
    const held: Intake = {
      ...base.intake,
      start: (body) =>
        new Promise((resolve, reject) => {
          answer = () => {
            base.intake.start(body).then(resolve, reject);
          };
        }),
    };
    const t = setUp({ intake: { ...base, intake: held } });
    await t.controller.load();
    void t.controller.record();
    await flush();
    t.controller.close();
    expect(t.controller.snapshot().state).toBe('closed');
    answer();
    await flush();
    expect(t.intake.calls).toContain('start');
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.controller.snapshot().state).toBe('closed');
    expect(t.log).toContain('release');
    expect(t.video.actions).toEqual([]);
  });

  it('a start the intake refuses leaves nothing open and says why', async () => {
    const t = await recording({
      intake: fakeIntake(LINK, { start: new IntakeError(429, 'too_many_requests') }),
    });
    expect(t.controller.snapshot().state).toBe('busy');
    expect(t.intake.aborts).toEqual([]);
    expect(t.log).toContain('release');
  });

  it('a share the visitor cancels starts nothing', async () => {
    const t = await recording({
      acquire: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
    expect(t.controller.snapshot().state).toBe('ready');
    expect(t.intake.calls).toEqual(['readLink']);
  });

  it('never aborts a finished recording, even when the page unloads afterwards', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    await t.controller.send();
    await flush();
    t.controller.pageHidden();
    await flush();
    expect(t.intake.aborts).toEqual([]);
    expect(t.intake.finalized).toHaveLength(1);
  });
});

describe('the recording session it records into', () => {
  it('is a real engine session, stopped once the recording ends', async () => {
    const t = await recording();
    expect(t.session()?.state).toBe('recording');
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    expect(t.session()?.state).toBe('stopped');
  });
});

describe('the recording controller: watching before sending', () => {
  it('gives the watched WebM its duration, while the parts upload the bytes as recorded', async () => {
    const t = await recording();
    const element = (id: number[], body: number[]): number[] => [
      ...id,
      0x80 | body.length,
      ...body,
    ];
    const unknownSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    const info = element([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]);
    const head = [
      ...element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d])),
      ...[0x18, 0x53, 0x80, 0x67, ...unknownSize],
    ];
    const cluster = [0x1f, 0x43, 0xb6, 0x75, ...unknownSize, ...element([0xe7], [0x00])];
    const recorded = Uint8Array.from([
      ...head,
      ...element([0x15, 0x49, 0xa9, 0x66], info),
      ...cluster,
    ]);
    await t.video.emit(recorded);
    t.video.setDuration(4321);
    await t.controller.stop();
    await flush();

    const watched = t.controller.snapshot();
    expect(watched.state).toBe('review');
    const duration = new DataView(new ArrayBuffer(8));
    duration.setFloat64(0, 4321);
    const withDuration = [...info, 0x44, 0x89, 0x88, ...new Uint8Array(duration.buffer)];
    expect(new Uint8Array(await (watched.recording ?? new Blob()).arrayBuffer())).toEqual(
      Uint8Array.from([...head, ...element([0x15, 0x49, 0xa9, 0x66], withDuration), ...cluster]),
    );
    expect(watched.recording?.type).toBe('video/webm');
    await t.controller.send();
    await flush();
    const uploaded = Uint8Array.from(t.intake.partBytes.flatMap((part) => [...part]));
    expect(uploaded).toEqual(recorded);
    expect(t.intake.finalized).toEqual([4321]);
  });

  it('keeps a stopped recording to be watched, finalizing nothing until Send', async () => {
    const t = await recording();
    await t.video.emit('abcdef');
    await t.video.emit('gh');
    t.video.setDuration(4321);
    await t.controller.stop();
    await flush();

    const watched = t.controller.snapshot();
    expect(watched.state).toBe('review');
    expect(await watched.recording?.text()).toBe('abcdefgh');
    expect(watched.recording?.type).toBe('video/webm');
    // The parts go on uploading; the upload is not completed and the Vis not finalized.
    expect(t.intake.parts).toEqual([
      [1, 'abcd'],
      [2, 'efgh'],
    ]);
    expect(t.intake.calls).not.toContain('complete');
    expect(t.intake.finalized).toEqual([]);
    expect(t.intake.aborts).toEqual([]);
    expect(t.log).toContain('release');

    await t.controller.send();
    await flush();
    expect(t.intake.calls.slice(-2)).toEqual(['complete', 'finalize']);
    expect(t.intake.finalized).toEqual([4321]);
    expect(t.controller.snapshot()).toMatchObject({ state: 'done', recording: null });
    expect(t.states).toEqual([
      'loading',
      'ready',
      'starting',
      'recording',
      'review',
      'sending',
      'done',
    ]);
  });

  it('discarding a watched recording aborts it and finalizes nothing', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    await t.controller.discard();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.intake.calls).not.toContain('complete');
    expect(t.intake.finalized).toEqual([]);
    expect(t.controller.snapshot()).toMatchObject({ state: 'ready', recording: null });
  });

  it('recording again aborts the watched recording and starts a new one at once', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    void t.controller.recordAgain();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: false }]);
    expect(t.intake.finalized).toEqual([]);
    expect(t.intake.started).toHaveLength(2);
    expect(t.log.filter((line) => line.startsWith('acquire'))).toHaveLength(2);
    expect(t.controller.snapshot().state).toBe('recording');
  });

  it('the page unloading while the recording is watched aborts it', async () => {
    const t = await recording();
    await t.video.emit('abcd');
    await t.controller.stop();
    await flush();
    t.controller.pageHidden();
    await flush();
    expect(t.intake.aborts).toEqual([{ keepalive: true }]);
    expect(t.intake.finalized).toEqual([]);
  });

  it('sends the title of the link, which the visitor never edits', async () => {
    const t = setUp({ intake: fakeIntake({ ...LINK, title: 'From the link' }) });
    await t.controller.load();
    void t.controller.record();
    await flush();
    expect(t.intake.started[0]?.title).toBe('From the link');
  });
});

describe('the recording controller: a page on another origin', () => {
  it('says the origin may be refused when the link gets no answer from another origin', async () => {
    const outcomes: [boolean, boolean][] = [];
    for (const [crossOrigin, failure] of [
      [true, new IntakeError(null, 'network')],
      [false, new IntakeError(null, 'network')],
      [true, new IntakeError(500, null)],
      [true, new IntakeError(null, 'timeout')],
    ] as const) {
      const t = setUp({ intake: fakeIntake(LINK, { readLink: failure }), crossOrigin });
      await t.controller.load();
      expect(t.controller.snapshot().state).toBe('failed');
      outcomes.push([crossOrigin, t.controller.snapshot().originRefused]);
    }
    expect(outcomes).toEqual([
      [true, true],
      [false, false],
      [true, false],
      [true, false],
    ]);
  });
});

describe('the recording controller: refusals of the widget intake', () => {
  it('names the widget refusal of a start, ending unavailable or busy', async () => {
    const outcomes: [RecorderState, unknown][] = [];
    for (const failure of [
      new IntakeError(401, 'reporter_required'),
      new IntakeError(401, 'invalid_reporter', 'expired'),
      new IntakeError(429, 'too_many_requests', 'hourly_cap'),
      new IntakeError(429, 'too_many_requests', 'too_many_open'),
      new IntakeError(429, 'too_many_requests', 'rate_limited'),
      new IntakeError(429, 'too_many_requests', 'something_new'),
    ]) {
      const t = await recording({
        intake: fakeIntake(LINK, { start: failure }),
        refusalOf: widgetRefusalOf,
      });
      outcomes.push([t.controller.snapshot().state, t.controller.snapshot().refusal]);
      expect(t.log).toContain('release');
      expect(t.intake.aborts).toEqual([]);
    }
    expect(outcomes).toEqual([
      ['unavailable', 'reporter_required'],
      ['unavailable', 'invalid_reporter'],
      ['busy', 'hourly_cap'],
      ['busy', 'too_many_open'],
      ['busy', 'rate_limited'],
      ['busy', null],
    ]);
  });

  it('names the refusal of reading the configuration', async () => {
    const t = setUp({
      intake: fakeIntake(LINK, {
        readLink: new IntakeError(429, 'too_many_requests', 'rate_limited'),
      }),
      refusalOf: widgetRefusalOf,
    });
    await t.controller.load();
    expect(t.controller.snapshot()).toMatchObject({ state: 'busy', refusal: 'rate_limited' });
  });

  it('keeps the refusal empty for a recording link, as before', async () => {
    const t = await recording({
      intake: fakeIntake(LINK, {
        start: new IntakeError(429, 'too_many_requests', 'rate_limited'),
      }),
    });
    expect(t.controller.snapshot()).toMatchObject({ state: 'busy', refusal: null });
    const refused = await recording({
      intake: fakeIntake(LINK, { start: new IntakeError(401, 'reporter_required') }),
    });
    expect(refused.controller.snapshot()).toMatchObject({ state: 'failed', refusal: null });
  });
});
