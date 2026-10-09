test:
	docker compose run --rm --no-deps gateway npm run test
	docker compose run --rm --no-deps aggregator npm run test
	docker compose run --rm --no-deps earnings npm run test
	docker compose run --rm --no-deps api npm run test
	docker compose run --rm --no-deps classifier npm run test
up:
	docker compose up -d --build
down:
	docker compose down
small-flow:
	node web2-kit/generator/andx-gen.js gen --preset small --seed 7 --out ./data-small
	node web2-kit/generator/andx-gen.js send --data ./data-small --url http://localhost:8080 --rate 20000 --burst-mult 10 --burst-secs 60 --burst-at 0.5
	node web2-kit/generator/andx-gen.js check --api http://localhost:8081 --expected web2-kit/expected/small-seed7.json
