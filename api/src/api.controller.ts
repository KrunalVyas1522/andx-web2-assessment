import { Controller, Get, Post, Body, Param, Query, HttpCode } from '@nestjs/common';
import { ApiService } from './api.service';

@Controller('v1')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Post('admin/campaigns')
  @HttpCode(200)
  upsertCampaigns(@Body() campaigns: any[]) {
    return this.apiService.upsertCampaigns(campaigns);
  }

  @Get('stats')
  getStats() {
    return this.apiService.getStats();
  }

  @Post('dlq/replay')
  @HttpCode(202)
  replayDlq(@Body() body: { reason: string }) {
    return this.apiService.replayDlq(body.reason);
  }

  @Get('campaigns/:id/spend')
  getCampaignSpend(@Param('id') id: string) {
    return this.apiService.getCampaignSpend(id);
  }

  @Get('creators/:id/earnings')
  getCreatorEarnings(@Param('id') id: string) {
    return this.apiService.getCreatorEarnings(id);
  }

  @Get('campaigns/:id/top-clips')
  getTopClips(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
  ) {
    return this.apiService.getTopClips(id, from, to, limit, cursor);
  }

  @Get('clips/:clip_id/relevance')
  getClipRelevance(@Param('clip_id') clipId: string) {
    return this.apiService.getClipRelevance(clipId);
  }
}
