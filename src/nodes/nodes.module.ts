import { Module } from '@nestjs/common';
import { NodesService } from './nodes.service.js';
import { NodesController } from './nodes.controller.js';

@Module({
  providers: [NodesService],
  controllers: [NodesController]
})
export class NodesModule {}
