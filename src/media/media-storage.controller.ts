import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from './media-storage.service.js';

/**
 * Отдача сохранённых media-файлов (R7.8, KI-362).
 *
 * `stored_url` из `node_runs` указывает сюда (`/media/file/<runId>/<fileName>`),
 * чтобы UI мог показать картинку/видео, не завися от 48-часовой ссылки
 * провайдера.
 *
 * **Почему без `JwtAuthGuard`.** Браузер запрашивает `<img src>`/`<video src>`
 * без заголовка `Authorization` (JWT живёт в памяти клиента, не в cookie),
 * поэтому защищённая ручка отдавала бы 401 на каждый рендер. Ссылка
 * непредсказуема: `runId` — uuid запуска, имя файла — нормализованный `nodeId`;
 * перебрать их нельзя, а сам файл и так был доступен по ссылке провайдера.
 * Подписанные URL — отдельная задача (см. отчёт R7.8).
 */
@Controller('media')
export class MediaStorageController {
  /**
   * @param storage - хранилище, в которое executor складывает результаты
   */
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: IMediaStorage) {}

  /**
   * `GET /media/file/:runId/:fileName` — сохранённый результат узла.
   *
   * @param runId - uuid запуска (первый сегмент ключа)
   * @param fileName - имя файла с расширением (второй сегмент)
   * @returns поток файла с `Content-Type` и `Content-Length`
   * @throws NotFoundException если файла нет или бэкенд не отдаёт файлы
   */
  @Get('file/:runId/:fileName')
  @Header('Cache-Control', 'public, max-age=86400')
  async readFileAsync(
    @Param('runId') runId: string,
    @Param('fileName') fileName: string,
  ): Promise<StreamableFile> {
    const storageKey = `${runId}/${fileName}`;
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
