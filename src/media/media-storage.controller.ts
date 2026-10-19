import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from './media-storage.service.js';
import {
  resolveMediaSigningOptions,
  verifyMediaFileSignature,
} from './media-url-signer.js';

/**
 * Отдача сохранённых media-файлов (R7.8, KI-362; подпись — KI-415).
 *
 * `stored_url` из `node_runs` указывает сюда (`/media/file/<runId>/<fileName>`),
 * чтобы UI мог показать картинку/видео, не завися от 48-часовой ссылки
 * провайдера.
 *
 * **Почему без `JwtAuthGuard`.** Браузер запрашивает `<img src>`/`<video src>`
 * без заголовка `Authorization` (JWT живёт в памяти клиента, не в cookie),
 * поэтому защищённая ручка отдавала бы 401 на каждый рендер. Вместо этого
 * ссылка подписывается HMAC (`?expires=...&sign=...`): `runId` — uuid, но
 * сама по себе непредсказуемость пути не защищала от утечки ссылки в логи,
 * историю браузера и `Referer` (KI-415). Подпись выпускает
 * `LocalMediaStorage` при сохранении файла, а снимок запуска перевыпускает её
 * по `node_runs.storage_key` (KI-464).
 *
 * **Совместимость.** Если секрет подписи не задан (`MEDIA_URL_SIGNING_SECRET`
 * и `JWT_SECRET` пусты — unit-тесты без env), ручка работает как раньше: без
 * подписи. В приложении `JWT_SECRET` обязателен, поэтому подпись включена.
 */
@Controller('media')
export class MediaStorageController {
  /**
   * @param storage - хранилище, в которое executor складывает результаты
   * @param config - доступ к env (RULES 4.6): секрет и TTL подписи (KI-415)
   */
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: IMediaStorage,
    private readonly config: ConfigService,
  ) {}

  /**
   * `GET /media/file/:runId/:fileName` — сохранённый результат узла.
   *
   * @param runId - uuid запуска (первый сегмент ключа)
   * @param fileName - имя файла с расширением (второй сегмент)
   * @param sign - HMAC-подпись ссылки (KI-415)
   * @param expires - срок действия подписи, unix-секунды (KI-415)
   * @returns поток файла с `Content-Type` и `Content-Length`
   * @throws ForbiddenException если подпись настроена, но невалидна или истекла
   * @throws NotFoundException если файла нет или бэкенд не отдаёт файлы
   */
  @Get('file/:runId/:fileName')
  // Подписанный URL — capability: общий кэш прокси не должен хранить ответ, а
  // браузеру хватает короткого TTL (ссылка всё равно перевыпускается на чтении).
  @Header('Cache-Control', 'private, max-age=300')
  async readFileAsync(
    @Param('runId') runId: string,
    @Param('fileName') fileName: string,
    @Query('sign') sign?: string,
    @Query('expires') expires?: string,
  ): Promise<StreamableFile> {
    const storageKey = `${runId}/${fileName}`;
    const signing = resolveMediaSigningOptions(this.config);

    if (signing !== null && !verifyMediaFileSignature(storageKey, sign, expires, signing)) {
      throw new ForbiddenException(
        'Недействительная или истёкшая подпись media-ссылки',
      );
    }

    const file = await this.storage.openAsync(storageKey);

    if (file === null) {
      throw new NotFoundException(`Media-файл не найден: ${storageKey}`);
    }

    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.bytes,
      disposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    });
  }
}
