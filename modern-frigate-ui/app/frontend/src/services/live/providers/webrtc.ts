import { socketUrl } from "../../api";
import { browserCapabilities } from "../capabilities";
import { ProviderError, type LiveStreamProvider, type ProviderContext } from "../types";

/**
 * WebRTC (go2rtc signalling relayed over our own WebSocket).
 *
 * Kept as a strong secondary transport: lowest latency, and the right choice
 * when a browser/codec combination cannot be fed through MSE. It fails fast —
 * ICE that cannot complete through NAT or a remote-access tunnel must not hold
 * the ladder for long, so the budget is short and `failed`/`disconnected` ICE
 * states abort immediately instead of waiting for the timeout.
 */
export const WebRTCStreamProvider: LiveStreamProvider = {
  name: "WebRTCStreamProvider",
  kind: "webrtc",
  timeoutMs: 6_000,
  supported: () => {
    const caps = browserCapabilities();
    return caps.webSocket && caps.webrtc;
  },
  connect: (context: ProviderContext) =>
    new Promise((resolve, reject) => {
      const video = context.video;
      if (!video || typeof RTCPeerConnection === "undefined") {
        return reject(new ProviderError("WebRTC unsupported"));
      }

      // Host candidates only: go2rtc sits on the same network as Home Assistant.
      const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
      const socket = new WebSocket(socketUrl(context.path));
      let stopped = false;
      let live = false;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(timer);
        context.signal.removeEventListener("abort", stop);
        try {
          socket.close();
        } catch {}
        try {
          peer.getSenders().forEach((sender) => sender.track?.stop());
        } catch {}
        try {
          peer.close();
        } catch {}
        // Never leave a MediaStream attached to a recycled <video>.
        video.srcObject = null;
      };

      const fail = (reason: string) => {
        if (stopped) return;
        if (live) {
          context.onDrop(reason);
          return;
        }
        stop();
        reject(new ProviderError(reason));
      };

      const timer = window.setTimeout(() => fail("WebRTC could not connect"), WebRTCStreamProvider.timeoutMs);

      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.ontrack = (event) => {
        if (stopped) return;
        video.removeAttribute("src");
        video.srcObject = event.streams[0] ?? null;
        void video.play().catch(() => undefined);
      };
      peer.oniceconnectionstatechange = () => {
        if (stopped) return;
        const state = peer.iceConnectionState;
        if ((state === "connected" || state === "completed") && !live) {
          live = true;
          window.clearTimeout(timer);
          context.onDimensions(video.videoWidth, video.videoHeight);
          context.log("webrtc connected");
          resolve({ kind: "webrtc", stop });
        }
        if (state === "failed") fail("WebRTC connection failed");
        if (state === "disconnected" && live) fail("WebRTC connection dropped");
      };
      peer.onicecandidate = (event) => {
        if (stopped || socket.readyState !== 1) return;
        socket.send(
          JSON.stringify({ type: "webrtc/candidate", value: event.candidate?.candidate ?? "" }),
        );
      };

      socket.onopen = async () => {
        try {
          const offer = await peer.createOffer();
          if (stopped) return;
          await peer.setLocalDescription(offer);
          if (stopped) return;
          socket.send(JSON.stringify({ type: "webrtc/offer", value: peer.localDescription?.sdp }));
        } catch {
          fail("WebRTC negotiation failed");
        }
      };
      socket.onerror = () => fail("WebRTC relay unreachable");
      socket.onclose = () => {
        if (!live) fail("WebRTC relay closed");
      };
      socket.onmessage = async (message) => {
        if (stopped) return;
        try {
          const payload = JSON.parse(message.data);
          if (payload.type === "webrtc/answer") {
            await peer.setRemoteDescription({ type: "answer", sdp: payload.value });
          } else if (payload.type === "webrtc/candidate" && payload.value) {
            await peer
              .addIceCandidate({ candidate: payload.value, sdpMid: "0" })
              .catch(() => undefined);
          } else if (payload.type === "error") {
            fail("Stream not available");
          }
        } catch {
          /* non-JSON signalling frames are ignored */
        }
      };

      context.signal.addEventListener("abort", stop, { once: true });
    }),
};
