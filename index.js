const glslify = require('glslify')
const regl = require('regl')({
  extensions: 'OES_texture_float',
  onDone: (err) => err &&
    (document.body.innerHTML = `
    <h1 style="color: red;">
    Your browser does not support WebGL and/or floating point textures.
    </h1>
    `)
})
const lookAt = require('gl-mat4/lookAt')
const perspective = require('gl-mat4/perspective')

const skullTex = regl.texture()
const prevPixels = regl.texture({
  copy: true
})

const bigTriangle = {
  vert: `
  precision mediump float;
  attribute vec2 position;
  varying vec2 uv;
  void main () {
    uv = 0.5 * (position + 1.0);
    gl_Position = vec4(position, 0, 1);
  }
  `,

  attributes: {
    position: [
      [-4, 0],
      [4, 4],
      [4, -4]
    ]
  },

  count: 3
}

const drawBackground = regl(Object.assign({
  frag: `
  precision highp float;
  uniform sampler2D prevPixels;
  varying vec2 uv;

  void main () {
    vec4 pcolor = texture2D(prevPixels, uv);
    gl_FragColor = vec4(pcolor.rgb * 0.99, 1);
  }
  `,

  depth: {
    enable: false
  },

  uniforms: {
    prevPixels
  }
}, bigTriangle))

const N = 32
const T = 3

const stateFBO = Array(T).fill().map(() =>
  regl.framebuffer({
    depthStencil: false,
    color: regl.texture({
      radius: N,
      type: 'float',
      data: (() => {
        const points = []
        for (let i = 0; i < N; ++i) {
          for (let j = 0; j < N; ++j) {
            const theta = i / N * 2.0 * Math.PI
            const phi = j / N * 2.0 * Math.PI
            const radius = 1.0
            points.push(
              radius * Math.cos(theta) * Math.cos(phi),
              radius * Math.sin(theta) * Math.cos(phi),
              radius * Math.sin(phi),
              1)
          }
        }
        return points
      })()
    })
  }))

function nextFBO ({tick}) {
  return stateFBO[tick % T]
}

function prevFBO (n) {
  return ({tick}) => stateFBO[(tick + T - n) % T]
}

const update = regl(Object.assign({
  framebuffer: nextFBO,

  uniforms: {
    'state[0]': prevFBO(1),
    'state[1]': prevFBO(2),
    resolution: ({viewportWidth, viewportHeight}) =>
      [viewportWidth, viewportHeight]
  },

  frag: glslify`
  precision highp float;
  uniform sampler2D state[2];
  varying vec2 uv;

  #pragma glslify: curlNoise = require('glsl-curl-noise')

  vec3 force (vec3 p) {
    return 0.00001 * curlNoise(p) + 0.000005 * (normalize(p) - p);
  }

  void main () {
    vec3 s0 = texture2D(state[0], uv).xyz;
    vec3 s1 = texture2D(state[1], uv).xyz;

    vec3 nextPos = 2. *s0 - s1 + force(s0);

    gl_FragColor = vec4(nextPos, 1);
  }
  `
}, bigTriangle))

const drawSkulls = regl({
  vert: `
  precision highp float;
  attribute vec2 position, id;
  attribute float size;
  varying vec2 uv;
  uniform mat4 projection, view;
  uniform sampler2D skullPosition;

  void main () {
    uv = 0.5 * (position + 1.0);
    vec3 worldPos = texture2D(skullPosition, id).xyz;
    gl_Position = projection * (vec4(size * position, 0, 0) + view * vec4(worldPos, 1));
  }
  `,

  frag: `
  precision highp float;
  varying vec2 uv;
  uniform sampler2D skullTex;

  void main () {
    vec4 color = texture2D(skullTex, vec2(uv.x, 1.0 - uv.y));
    if (min(min(color.r, color.g), color.b) >= 0.8) {
      discard;
    }
    gl_FragColor = color;
  }
  `,

  attributes: (() => {
    const positions = []
    const ids = []
    const size = []

    for (let i = 0; i < N; ++i) {
      for (let j = 0; j < N; ++j) {
        positions.push([
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ])
        const s = Math.random() * 0.125
        for (let l = 0; l < 6; ++l) {
          ids.push([
            i / N,
            j / N
          ])
          size.push(s)
        }
      }
    }

    return {
      position: positions,
      id: ids,
      size
    }
  })(),

  uniforms: {
    skullTex,
    skullPosition: nextFBO,
    projection: (() => {
      const M = new Float32Array(16)
      return ({viewportWidth, viewportHeight}) =>
        perspective(M,
          Math.PI / 4.0,
          viewportWidth / viewportHeight,
          0.125,
          1000)
    })(),
    view: (() => {
      const M = new Float32Array(16)
      return ({tick}) => {
        const t = 0.001 * tick
        return lookAt(M,
          [5 * Math.cos(t), 0, 10 * Math.sin(t)],
          [0, 0, 0],
          [0, 1, 0])
      }
    })()
  },

  count: N * N * 6
})

require('resl')({
  manifest: {
    skull: {
      type: 'video',
      src: 'skull.mp4'
    }
  },

  onDone: ({skull}) => {
    skull.loop = true
    skull.play()
    skullTex(skull)
    regl.frame(() => {
      regl.clear({
        depth: 1
      })
      drawBackground()
      drawSkulls()
      update()
      skullTex(skull)
      prevPixels({copy: true})
    })
  }
})
