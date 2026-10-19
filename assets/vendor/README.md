# 同梱ライブラリ

- Three.js 0.186.1: https://www.npmjs.com/package/three/v/0.186.1
  - `build/three.module.js` と `build/three.core.js` を使用
  - ライセンス：`three/LICENSE`（MIT）
- cannon-es 0.20.0: https://www.npmjs.com/package/cannon-es/v/0.20.0
  - `dist/cannon-es.js` を使用
  - ライセンス：`cannon-es/LICENSE`（MIT）

npm公開パッケージの上記ファイルを、esbuild（`minify: true`, `format: "esm"`, `target: "es2020"`, `legalComments: "inline"`）で個別に縮小しています。モジュール名・相対importを維持しています。アプリ配信時のビルドやnpmインストールは不要です。

更新時は配布元のバージョン・ライセンス・依存ファイルを確認し、Service Workerのキャッシュバージョンも更新してください。
