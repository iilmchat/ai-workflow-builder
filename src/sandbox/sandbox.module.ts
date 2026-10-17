/**
 * Модуль WASM-песочницы QuickJS (R7.5).
 *
 * Экспортирует {@link QuickJsRunnerService} — общий исполнитель JS-выражений
 * для узла `condition` (режим `sandbox`) и будущего agent-tool `code_eval`
 * (DESIGN v0.9 § 3.4, § 3.5). Модуль импортируется туда, где живёт потребитель
 * (сейчас — `RunsModule`, где зарегистрирован `ExecutionEngineService`),
 * поэтому WASM грузится лениво и только при первом `sandbox`-узле.
 */
import { Module } from '@nestjs/common';
import { QuickJsRunnerService } from './quickjs-runner.service.js';

@Module({
  providers: [QuickJsRunnerService],
  exports: [QuickJsRunnerService],
})
export class SandboxModule {}
