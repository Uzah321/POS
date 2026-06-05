<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class Webhook extends Model {
    use HasFactory;
    protected $fillable = ['name','url','events','secret','active','last_triggered_at'];
    protected $casts = ['events'=>'array','active'=>'boolean','last_triggered_at'=>'datetime'];
}
