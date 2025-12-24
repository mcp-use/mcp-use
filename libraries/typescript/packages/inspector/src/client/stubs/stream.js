// Browser stub for node:stream
// This stub is used when building for the browser to avoid bundling Node.js-specific code

export class PassThrough {
  constructor() {
    console.warn("PassThrough stream is not available in browser environment");
  }
}

export class Readable {
  constructor() {
    console.warn("Readable stream is not available in browser environment");
  }
}

export class Writable {
  constructor() {
    console.warn("Writable stream is not available in browser environment");
  }
}

export class Transform {
  constructor() {
    console.warn("Transform stream is not available in browser environment");
  }
}

export class Duplex {
  constructor() {
    console.warn("Duplex stream is not available in browser environment");
  }
}

export default {
  PassThrough,
  Readable,
  Writable,
  Transform,
  Duplex,
};
