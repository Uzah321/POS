<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Observers\AuditObserver;
use App\Models\{Sale, Product, User, Customer, Supplier, Branch, Expense};

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        foreach ([Sale::class, Product::class, User::class, Customer::class, Supplier::class, Branch::class, Expense::class] as $model) {
            $model::observe(AuditObserver::class);
        }
    }
}
