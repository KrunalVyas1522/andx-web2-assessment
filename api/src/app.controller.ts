import { Controller, Get } from '@nestjs/common';
import { ApiService } from './api.service';

@Controller()
export class AppController {
  constructor(private readonly apiService: ApiService) {}

  @Get('healthz')
  getHealth() {
    return this.apiService.getHealth();
  }
}
