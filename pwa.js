// Keep installation independent of the 3D engine and advertising scripts.
if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((error) => {
        console.warn("オフライン利用の準備ができませんでした。", error);
    });
}
