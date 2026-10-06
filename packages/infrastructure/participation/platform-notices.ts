import { randomUUID } from "node:crypto";
import { NoticeSender } from "../../application/participation/notice-sender.ts";
import type { ParticipationService } from "../../application/participation/service.ts";
import {
  YoutubeNoticeTransport,
  type YoutubeNoticeAccount,
} from "../platforms/youtube-notice-transport.ts";
import {
  ChzzkNoticeTransport,
  type ChzzkNoticeAccount,
} from "../platforms/chzzk-notice-transport.ts";
const runtime = { now: () => Date.now(), id: randomUUID };
export class YoutubeNotices extends NoticeSender {
  constructor(
    participation: ParticipationService,
    account: YoutubeNoticeAccount,
    request: typeof fetch = fetch,
  ) {
    super(
      participation,
      "youtube",
      new YoutubeNoticeTransport(account, request),
      runtime,
    );
  }
}
export class ChzzkNotices extends NoticeSender {
  constructor(
    participation: ParticipationService,
    account: ChzzkNoticeAccount,
    request: typeof fetch = fetch,
  ) {
    super(
      participation,
      "chzzk",
      new ChzzkNoticeTransport(account, request),
      runtime,
    );
  }
}
