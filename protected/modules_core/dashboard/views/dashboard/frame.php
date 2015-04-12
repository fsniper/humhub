<?php
/**
 * Created by Samet Atdag
 * Date: 08.04.15
 */
?>
<div class="container">
    <div class="row">
        <div class="col-md-8">
            <?php
            $this->widget('application.modules_core.post.widgets.FrameFormWidget', array(
                'contentContainer' => Yii::app()->user->model,
                'url' => $url
            ));
            ?>
        </div>
    </div>

</div>
