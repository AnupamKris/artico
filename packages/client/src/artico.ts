import logger, { LogLevel } from "@rtco/logger";
import EventEmitter from "eventemitter3";
import { InSignalMessage, Signaling, SignalingState } from "~/signaling";
import { SocketSignaling } from "~/signaling/socket-io";
import { Call } from "~/call";
import { Room } from "~/room";

export type ArticoEvents = {
  open: (id: string) => void;
  close: () => void;
  error: (err: Error) => void;
  call: (call: Call) => void;
};

export type ArticoOptions = {
  debug: LogLevel;
  signaling: Signaling;
  id: string;
};

interface IArtico {
  get id(): string;
  get state(): SignalingState;
  close: () => void;
  call: (target: string, metadata?: string) => Call;
  join: (roomId: string, metadata?: string) => Room;
}

export class Artico extends EventEmitter<ArticoEvents> implements IArtico {
  #debug: LogLevel;
  #signaling: Signaling;
  #calls: Map<string, Call> = new Map();

  constructor(options?: Partial<ArticoOptions>) {
    super();

    this.#debug = options?.debug ?? LogLevel.Errors;
    logger.logLevel = this.#debug;
    logger.debug("new Artico:", options);

    this.#signaling = options?.signaling ?? new SocketSignaling();
    this.#setupSignalingListeners();

    this.#signaling.connect(options?.id);
  }

  get id() {
    return this.#signaling.id;
  }

  get state() {
    return this.#signaling.state;
  }

  call = (target: string, metadata?: string) => {
    logger.debug(`call(${target}, ${metadata})`);

    if (this.#signaling.state !== "ready") {
      throw new Error("Cannot call peers until signaling is ready.");
    }

    const call = new Call({
      signaling: this.#signaling,
      debug: this.#debug,
      target,
      metadata,
    });
    this.#calls.set(call.id, call);
    return call;
  };

  join = (roomId: string, metadata?: string) => {
    logger.debug("join:", roomId, metadata);

    if (this.#signaling.state !== "ready") {
      throw new Error("Cannot join room until signaling is ready.");
    }

    const room = new Room(this.#signaling, roomId, {
      debug: this.#debug,
      metadata,
    });
    return room;
  };

  close = () => {
    logger.debug("close");
    this.removeAllListeners();
    this.#removeSignalingListeners();
    this.#signaling.disconnect();
    this.emit("close");
  };

  #setupSignalingListeners() {
    this.#signaling.on("error", this.#handleError.bind(this));
    this.#signaling.on("connect", this.#handleConnect.bind(this));
    this.#signaling.on("disconnect", this.#handleDisconnect.bind(this));
    this.#signaling.on("signal", this.#handleSignal.bind(this));
  }

  #removeSignalingListeners() {
    this.#signaling.off("error", this.#handleError);
    this.#signaling.off("connect", this.#handleConnect);
    this.#signaling.off("disconnect", this.#handleDisconnect);
    this.#signaling.off("signal", this.#handleSignal);
  }

  #handleError(err: Error) {
    this.emit("error", err);
  }

  #handleConnect(id: string) {
    this.emit("open", id);
  }

  #handleDisconnect() {
    this.close();
  }

  #handleSignal(msg: InSignalMessage) {
    // Artico only handles the first signal for a call,
    // so it can generate a "call" event for the app.
    logger.debug("artico rx signal:", msg);
    if (
      msg.session.startsWith(Call.ID_PREFIX) &&
      !this.#calls.has(msg.session)
    ) {
      logger.debug("call from", msg.source, msg.signal);

      const call = new Call({
        debug: this.#debug,
        signaling: this.#signaling,
        metadata: msg.metadata,
        signal: msg,
      });
      this.#calls.set(call.id, call);
      this.emit("call", call);
    }
  }
}
